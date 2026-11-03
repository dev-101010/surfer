'use strict';

const fs = require('fs');
const path = require('path');
const {EventEmitter} = require('events');
const {t} = require('./i18n');

const LEVELS = ['debug', 'info', 'warn', 'error', 'block'];
const MAX_MESSAGE = 2000;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// everything below 0x20 except \n (stack traces), plus DEL and C1 controls
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

const COLORS = {
    reset: '\x1b[0m',
    debug: '\x1b[90m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    block: '\x1b[90m',
    source: '\x1b[35m',
    time: '\x1b[90m'
};

function stringify(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * In-memory ring buffer logger with optional console and file sinks.
 * Emits 'entry' for every new log line so the control window can show it live.
 */
class Logger extends EventEmitter {
    constructor({max = 3000} = {}) {
        super();
        this.max = max;
        this.buffer = [];
        this.seq = 0;
        this.console = true;
        this.colors = !process.env.NO_COLOR;
        this.filePath = null;
        this.stream = null;
        this.fileSize = 0;
    }

    log(level, source, message) {
        if (!LEVELS.includes(level)) level = 'info';
        // Messages contain untrusted text (page titles, URLs): strip control characters so a page
        // can neither inject terminal escape sequences nor forge additional log lines.
        const text = stringify(message).slice(0, MAX_MESSAGE).replace(CONTROL_CHARS, ' ');
        const src = String(source || 'Surfer').slice(0, 80).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
        const entry = {id: ++this.seq, ts: Date.now(), level, source: src, message: text};
        this.buffer.push(entry);
        if (this.buffer.length > this.max) this.buffer.splice(0, this.buffer.length - this.max);
        this._writeConsole(entry);
        this._writeFile(entry);
        this.emit('entry', entry);
        return entry;
    }

    debug(source, msg) { return this.log('debug', source, msg); }
    info(source, msg) { return this.log('info', source, msg); }
    warn(source, msg) { return this.log('warn', source, msg); }
    error(source, msg) { return this.log('error', source, msg); }
    block(source, msg) { return this.log('block', source, msg); }

    entries() {
        return this.buffer.slice();
    }

    clear() {
        this.buffer = [];
        this.emit('cleared');
    }

    setConsole(enabled) {
        this.console = Boolean(enabled);
    }

    /** Enables (path) or disables (null) the file sink. */
    setFile(filePath) {
        if (filePath === this.filePath) return;
        this._closeFile();
        this.filePath = filePath || null;
        if (!this.filePath) return;
        try {
            fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
            this.fileSize = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
            this._openStream();
        } catch (err) {
            this.filePath = null;
            this.error('Logger', t('logger.openFailed', {error: err.message}));
        }
    }

    _openStream() {
        this.stream = fs.createWriteStream(this.filePath, {flags: 'a', encoding: 'utf-8'});
        this.stream.on('error', err => {
            this.stream = null;
            this.filePath = null;
            this.error('Logger', t('logger.fileError', {error: err.message}));
        });
    }

    _closeFile() {
        if (this.stream) {
            try {
                this.stream.end();
            } catch { /* ignore */ }
        }
        this.stream = null;
    }

    close() {
        this._closeFile();
    }

    _writeConsole(entry) {
        if (!this.console) return;
        const time = new Date(entry.ts).toLocaleTimeString('de-DE');
        let line;
        if (this.colors) {
            line = `${COLORS.time}${time}${COLORS.reset} ${COLORS.source}[${entry.source}]${COLORS.reset} ${COLORS[entry.level]}${entry.message}${COLORS.reset}`;
        } else {
            line = `${time} [${entry.source}] ${entry.level.toUpperCase()} ${entry.message}`;
        }
        try {
            (entry.level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
        } catch { /* stdout may be closed */ }
    }

    _writeFile(entry) {
        if (!this.stream) return;
        const line = `${new Date(entry.ts).toISOString()} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}] ${entry.message}\n`;
        this.fileSize += Buffer.byteLength(line);
        this.stream.write(line);
        if (this.fileSize > MAX_FILE_SIZE) this._rotate();
    }

    _rotate() {
        const file = this.filePath;
        this._closeFile();
        try {
            const old = `${file}.1`;
            if (fs.existsSync(old)) fs.unlinkSync(old);
            fs.renameSync(file, old);
        } catch { /* keep appending to the current file */ }
        this.fileSize = 0;
        try {
            this._openStream();
        } catch {
            this.filePath = null;
        }
    }
}

module.exports = {Logger, LEVELS};
