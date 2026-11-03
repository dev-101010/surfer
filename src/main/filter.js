'use strict';

const {hostOf, hostMatches, sameSite} = require('./domain');
const {t} = require('./i18n');

const MEDIA_CONTENT_TYPES = [
    'video/', 'audio/',
    'application/vnd.apple.mpegurl', 'application/x-mpegurl',
    'application/dash+xml', 'application/vnd.ms-sstr+xml'
];

const ALLOW = Object.freeze({block: false});

function block(reason) {
    return {block: true, reason};
}

function safeUrl(url) {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

/**
 * Pure decision logic for requests, navigations and popups.
 * Holds no Electron references and is fully unit-tested.
 */
class RequestFilter {
    constructor() {
        this.settings = {};
        this.whitelist = new Set();
        this.blockedDomains = new Set();
        this.blockedExtensions = [];
        this.captchaWhitelist = new Set();
    }

    update(settings, lists) {
        this.settings = {...settings};
        this.whitelist = new Set(lists.whitelist);
        this.blockedDomains = new Set(lists.blockedDomains);
        this.blockedExtensions = [...lists.blockedExtensions];
        this.captchaWhitelist = new Set(lists.captchaWhitelist);
    }

    isWhitelisted(host) {
        return hostMatches(host, this.whitelist);
    }

    isCaptcha(host) {
        return hostMatches(host, this.captchaWhitelist);
    }

    /**
     * @param {{url: string, resourceType: string, frameDepth?: number}} req
     *   frameDepth: nesting level of the requested sub frame (1 = iframe in the top document)
     */
    checkRequest(req) {
        const s = this.settings;
        const u = safeUrl(req.url);
        if (!u) return ALLOW;
        const protocol = u.protocol;
        const host = hostOf(req.url);
        const type = req.resourceType;

        if (host && this.isCaptcha(host)) return ALLOW;

        if (s.MAX_IFRAME_DEPTH > 0 && type === 'subFrame' && (req.frameDepth || 0) > s.MAX_IFRAME_DEPTH) {
            return block(t('f.frameDepth', {n: req.frameDepth}));
        }

        if (s.ALLOW_WHITELIST && host && this.isWhitelisted(host)) return ALLOW;

        if (s.BLOCK_MEDIA && (type === 'media' || type === 'object')) {
            return block(t('f.media'));
        }

        if (s.BLOCK_DOMAINS && host && hostMatches(host, this.blockedDomains)) {
            return block(t('f.domain'));
        }

        if (s.BLOCK_EXTENSIONS && this.blockedExtensions.length) {
            const pathname = (protocol === 'http:' || protocol === 'https:') ? u.pathname.toLowerCase() : '';
            if (pathname) {
                const ext = this.blockedExtensions.find(e => pathname.endsWith(e));
                if (ext) return block(t('f.extension', {ext}));
            }
        }

        if (s.BLOCK_OTHER_URL_TYPES) {
            if (type === 'webSocket' || protocol === 'ws:' || protocol === 'wss:') return block(t('f.websocket'));
            if ((protocol === 'blob:' || protocol === 'data:') && ['subFrame', 'media', 'object'].includes(type)) {
                return block(t(type === 'subFrame' ? 'f.dataFrame' : 'f.dataMedia', {protocol}));
            }
        }

        return ALLOW;
    }

    /**
     * @param {{url: string, resourceType: string, contentType?: string}} res
     */
    checkResponse(res) {
        const s = this.settings;
        if (!s.BLOCK_MEDIA || !res.contentType) return ALLOW;
        const host = hostOf(res.url);
        if (host && this.isCaptcha(host)) return ALLOW;
        if (s.ALLOW_WHITELIST && host && this.isWhitelisted(host)) return ALLOW;
        // Never cancel the top level document itself – that would only produce an error page.
        if (res.resourceType === 'mainFrame') return ALLOW;
        const ct = String(res.contentType).toLowerCase();
        if (MEDIA_CONTENT_TYPES.some(prefix => ct.startsWith(prefix))) return block(t('f.mediaType', {type: ct.split(';')[0]}));
        return ALLOW;
    }

    /** Main frame navigation initiated by the page. */
    checkNavigation(fromUrl, toUrl) {
        const target = safeUrl(toUrl);
        if (!target) return block(t('f.invalidUrl'));
        if (target.protocol === 'about:') return ALLOW;
        if (target.protocol !== 'http:' && target.protocol !== 'https:') return block(t('f.protocol', {protocol: target.protocol}));
        if (!this.settings.BLOCK_NAVIGATION_TO_OTHER_DOMAINS) return ALLOW;
        const toHost = target.hostname.toLowerCase();
        if (this.isWhitelisted(toHost) || this.isCaptcha(toHost)) return ALLOW;
        const fromHost = hostOf(fromUrl);
        if (!fromHost) return ALLOW;
        if (sameSite(fromHost, toHost)) return ALLOW;
        return block(t('f.navigation', {from: fromHost, to: toHost}));
    }

    /** window.open / target=_blank */
    checkPopup(sourceUrl, targetUrl) {
        const target = safeUrl(targetUrl);
        if (!target) return block(t('f.invalidPopup'));
        const isBlank = target.href === 'about:blank';
        if (!isBlank && target.protocol !== 'http:' && target.protocol !== 'https:') {
            return block(t('f.popupProtocol', {protocol: target.protocol}));
        }
        if (!this.settings.BLOCK_NOT_WHITELISTED_POPUPS) return ALLOW;
        const toHost = isBlank ? '' : target.hostname.toLowerCase();
        if (toHost && this.isWhitelisted(toHost)) return ALLOW;
        const fromHost = hostOf(sourceUrl);
        if (!fromHost) return block(t('f.popupUnknown'));
        if (this.isWhitelisted(fromHost)) return ALLOW;
        return block(t('f.popup', {from: fromHost, to: toHost || 'about:blank'}));
    }
}

module.exports = {RequestFilter};
