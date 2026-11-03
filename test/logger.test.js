'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {Logger} = require('../src/main/logger');

test('control characters from untrusted text are stripped', () => {
    const logger = new Logger();
    logger.setConsole(false);
    const e = logger.info('evil\x1b[2J', 'Titel: \x1b]0;pwned\x07 ok\r\nzweite Zeile');
    assert.equal(e.source.includes('\x1b'), false);
    assert.equal(e.message.includes('\x1b'), false);
    assert.equal(e.message.includes('\x07'), false);
    assert.equal(e.message.includes('\r'), false);
    assert.ok(e.message.includes('ok'));
});

test('ring buffer keeps only the newest entries', () => {
    const logger = new Logger({max: 3});
    logger.setConsole(false);
    for (let i = 0; i < 5; i++) logger.info('x', `m${i}`);
    assert.deepEqual(logger.entries().map(e => e.message), ['m2', 'm3', 'm4']);
});
