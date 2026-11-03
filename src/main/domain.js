'use strict';

/**
 * Hostname helpers. All matching is done on parsed hostnames, never on raw URL substrings,
 * so "https://evil.example/?x=shimly.de" can no longer pass a whitelist entry "shimly.de".
 */

// Common multi-label public suffixes. Not a full PSL, but good enough to decide whether two
// hosts belong to the same site (e.g. "a.example.co.uk" and "b.example.co.uk").
const MULTI_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'co.nz', 'org.nz', 'net.nz',
    'co.jp', 'ne.jp', 'or.jp',
    'co.za', 'org.za',
    'co.in', 'net.in', 'org.in',
    'co.kr', 'or.kr',
    'com.br', 'net.br', 'org.br',
    'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my',
    'com.pl', 'net.pl', 'org.pl', 'com.ua', 'com.ru', 'com.es', 'com.pt', 'com.gr',
    'co.at', 'or.at', 'co.il', 'co.id', 'co.th'
]);

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)(?:\.(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?))*$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isIp(host) {
    return IPV4_RE.test(host) || host.startsWith('[') || host.includes(':');
}

/** Returns the lowercase hostname of a URL without a trailing dot, or '' if not parseable. */
function hostOf(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
        const h = new URL(url).hostname.toLowerCase();
        return h.endsWith('.') ? h.slice(0, -1) : h;
    } catch {
        return '';
    }
}

/** Host without leading "www." for display purposes. */
function displayHost(url) {
    return hostOf(url).replace(/^www\./, '');
}

/**
 * True if `host` equals an entry of `set` or is a subdomain of one.
 * Runs in O(number of labels) instead of scanning the whole list.
 */
function hostMatches(host, set) {
    if (!host || !set || set.size === 0) return false;
    let h = host;
    for (; ;) {
        if (set.has(h)) return true;
        const dot = h.indexOf('.');
        if (dot < 0) return false;
        h = h.slice(dot + 1);
    }
}

/** Approximate registrable domain ("eTLD+1"). */
function siteOf(host) {
    if (!host) return '';
    if (isIp(host)) return host;
    const labels = host.split('.');
    if (labels.length <= 2) return host;
    const lastTwo = labels.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
    return lastTwo;
}

function sameSite(hostA, hostB) {
    return Boolean(hostA) && siteOf(hostA) === siteOf(hostB);
}

/**
 * Normalizes user input for a domain list entry.
 * Accepts "example.com", "*.example.com", "https://www.example.com/path", "Example.COM:8080".
 * Returns the normalized hostname or null if invalid.
 */
function normalizeDomain(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim().toLowerCase();
    if (!s || s.startsWith('#')) return null;
    s = s.replace(/^\*\./, '').replace(/^\.+/, '');
    let host;
    try {
        host = new URL(s.includes('://') ? s : `http://${s}`).hostname;
    } catch {
        return null;
    }
    host = host.replace(/\.$/, '').replace(/^www\./, '');
    if (!host) return null;
    if (IPV4_RE.test(host)) return host;
    return HOST_RE.test(host) ? host : null;
}

/** Normalizes a file extension entry ("mp4", ".MP4" -> ".mp4"). Returns null if invalid. */
function normalizeExtension(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim().toLowerCase();
    if (!s || s.startsWith('#')) return null;
    if (!s.startsWith('.')) s = `.${s}`;
    return /^\.[a-z0-9]{1,16}$/.test(s) ? s : null;
}

/** Validates a start URL. Returns the normalized URL string or null. */
function normalizeHttpUrl(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim();
    if (!s || s.length > 2048) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
    try {
        const u = new URL(s);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (!u.hostname) return null;
        if (u.username || u.password) return null;
        return u.toString();
    } catch {
        return null;
    }
}

module.exports = {
    hostOf,
    displayHost,
    hostMatches,
    siteOf,
    sameSite,
    normalizeDomain,
    normalizeExtension,
    normalizeHttpUrl
};
