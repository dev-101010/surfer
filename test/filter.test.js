'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {RequestFilter} = require('../src/main/filter');
const {DEFAULT_SETTINGS} = require('../src/main/schema');
const {DEFAULT_LISTS} = require('../src/main/config-store');

function make(settings = {}) {
    const f = new RequestFilter();
    f.update({...DEFAULT_SETTINGS, ...settings}, DEFAULT_LISTS);
    return f;
}

test('whitelist cannot be bypassed via query string', () => {
    const f = make();
    assert.equal(f.checkRequest({url: 'https://www.youtube.com/watch?ref=shimly.de', resourceType: 'subFrame', frameDepth: 1}).block, true);
    assert.equal(f.checkRequest({url: 'https://www.shimly.de/video.mp4', resourceType: 'xhr'}).block, false);
});

test('blocked domains include subdomains', () => {
    const f = make();
    assert.equal(f.checkRequest({url: 'https://m.youtube.com/', resourceType: 'subFrame', frameDepth: 1}).block, true);
    assert.equal(f.checkRequest({url: 'https://notyoutube.com/', resourceType: 'script'}).block, false);
});

test('extensions are matched on the path, ignoring query strings', () => {
    const f = make();
    assert.equal(f.checkRequest({url: 'https://cdn.example.com/a/clip.mp4?token=1', resourceType: 'xhr'}).block, true);
    assert.equal(f.checkRequest({url: 'https://cdn.example.com/a/page?file=clip.mp4', resourceType: 'xhr'}).block, false);
});

test('iframe depth', () => {
    const f = make({MAX_IFRAME_DEPTH: 2});
    assert.equal(f.checkRequest({url: 'https://ads.example.com/', resourceType: 'subFrame', frameDepth: 2}).block, false);
    assert.equal(f.checkRequest({url: 'https://ads.example.com/', resourceType: 'subFrame', frameDepth: 3}).block, true);
    assert.equal(make({MAX_IFRAME_DEPTH: 0}).checkRequest({url: 'https://ads.example.com/', resourceType: 'subFrame', frameDepth: 9}).block, false);
});

test('captcha providers pass even through iframe depth limit', () => {
    const f = make({MAX_IFRAME_DEPTH: 1});
    assert.equal(f.checkRequest({url: 'https://challenges.cloudflare.com/x', resourceType: 'subFrame', frameDepth: 5}).block, false);
});

test('media, websockets and data frames', () => {
    const f = make();
    assert.equal(f.checkRequest({url: 'https://example.com/stream', resourceType: 'media'}).block, true);
    assert.equal(f.checkRequest({url: 'wss://example.com/socket', resourceType: 'webSocket'}).block, true);
    assert.equal(f.checkRequest({url: 'https://example.com/?u=wss://x', resourceType: 'xhr'}).block, false);
    assert.equal(f.checkRequest({url: 'data:text/html,<b>x</b>', resourceType: 'subFrame', frameDepth: 1}).block, true);
    assert.equal(f.checkRequest({url: 'data:image/png;base64,AAAA', resourceType: 'image'}).block, false);
    assert.equal(make({BLOCK_OTHER_URL_TYPES: false}).checkRequest({url: 'wss://example.com/', resourceType: 'webSocket'}).block, false);
});

test('media content types in responses', () => {
    const f = make();
    assert.equal(f.checkResponse({url: 'https://cdn.example.com/x', resourceType: 'xhr', contentType: 'video/mp4'}).block, true);
    assert.equal(f.checkResponse({url: 'https://cdn.example.com/x', resourceType: 'xhr', contentType: 'application/vnd.apple.mpegurl'}).block, true);
    assert.equal(f.checkResponse({url: 'https://cdn.example.com/x', resourceType: 'mainFrame', contentType: 'video/mp4'}).block, false);
    assert.equal(f.checkResponse({url: 'https://shimly.de/x', resourceType: 'xhr', contentType: 'video/mp4'}).block, false);
    assert.equal(f.checkResponse({url: 'https://cdn.example.com/x', resourceType: 'xhr', contentType: 'text/html'}).block, false);
});

test('navigation stays on site unless whitelisted', () => {
    const f = make();
    assert.equal(f.checkNavigation('https://surf.example.com/a', 'https://www.example.com/b').block, false);
    assert.equal(f.checkNavigation('https://surf.example.com/a', 'https://other.com/').block, true);
    assert.equal(f.checkNavigation('https://other.com/a', 'https://shimly.de/').block, false);
    assert.equal(f.checkNavigation('https://example.com/', 'file:///C:/x').block, true);
    assert.equal(make({BLOCK_NAVIGATION_TO_OTHER_DOMAINS: false}).checkNavigation('https://a.com', 'https://b.com').block, false);
});

test('popups', () => {
    const f = make();
    assert.equal(f.checkPopup('https://shimly.de/surf', 'https://advertiser.com/').block, false);
    assert.equal(f.checkPopup('https://random.com/', 'https://shimly.de/').block, false);
    assert.equal(f.checkPopup('https://random.com/', 'https://advertiser.com/').block, true);
    assert.equal(f.checkPopup('', 'https://advertiser.com/').block, true);
    assert.equal(f.checkPopup('https://shimly.de/', 'javascript:alert(1)').block, true);
    assert.equal(make({BLOCK_NOT_WHITELISTED_POPUPS: false}).checkPopup('https://random.com/', 'https://x.com/').block, false);
});
