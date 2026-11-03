'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/main/domain');

test('hostMatches: exact and subdomains, never substrings', () => {
    const set = new Set(['shimly.de']);
    assert.equal(d.hostMatches('shimly.de', set), true);
    assert.equal(d.hostMatches('www.shimly.de', set), true);
    assert.equal(d.hostMatches('a.b.shimly.de', set), true);
    assert.equal(d.hostMatches('evilshimly.de', set), false);
    assert.equal(d.hostMatches('shimly.de.evil.com', set), false);
    assert.equal(d.hostMatches(d.hostOf('https://evil.com/?x=shimly.de'), set), false);
});

test('normalizeDomain accepts common input forms', () => {
    assert.equal(d.normalizeDomain('Example.COM'), 'example.com');
    assert.equal(d.normalizeDomain('https://www.example.com/path?q=1'), 'example.com');
    assert.equal(d.normalizeDomain('*.example.com'), 'example.com');
    assert.equal(d.normalizeDomain('example.com:8080'), 'example.com');
    assert.equal(d.normalizeDomain('192.168.0.1'), '192.168.0.1');
    assert.equal(d.normalizeDomain('münchen.de'), 'xn--mnchen-3ya.de');
    assert.equal(d.normalizeDomain('# comment'), null);
    assert.equal(d.normalizeDomain('not a domain'), null);
    assert.equal(d.normalizeDomain(''), null);
});

test('normalizeExtension', () => {
    assert.equal(d.normalizeExtension('MP4'), '.mp4');
    assert.equal(d.normalizeExtension('.m3u8'), '.m3u8');
    assert.equal(d.normalizeExtension('.tar.gz'), null);
    assert.equal(d.normalizeExtension('../x'), null);
});

test('normalizeHttpUrl only allows http(s) without credentials', () => {
    assert.equal(d.normalizeHttpUrl('example.com/surf'), 'https://example.com/surf');
    assert.equal(d.normalizeHttpUrl('http://example.com'), 'http://example.com/');
    assert.equal(d.normalizeHttpUrl('javascript:alert(1)'), null);
    assert.equal(d.normalizeHttpUrl('file:///etc/passwd'), null);
    assert.equal(d.normalizeHttpUrl('https://user:pw@example.com'), null);
    assert.equal(d.normalizeHttpUrl('x'.repeat(3000)), null);
});

test('siteOf / sameSite', () => {
    assert.equal(d.siteOf('a.b.example.com'), 'example.com');
    assert.equal(d.siteOf('shop.example.co.uk'), 'example.co.uk');
    assert.equal(d.sameSite('app.shimly.de', 'www.shimly.de'), true);
    assert.equal(d.sameSite('shimly.de', 'other.de'), false);
});
