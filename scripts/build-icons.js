'use strict';

/*
 * Generates the application icons from one SVG definition:
 *   assets/icon.svg   source (also used for documentation)
 *   assets/icon.png   512 px (Linux, macOS dock)
 *   assets/icon.ico   16–256 px (Windows window/taskbar icon)
 *
 * Run with:  npm run icons
 * Small sizes get thicker strokes so the waves stay readable at 16 px.
 */

const fs = require('fs');
const path = require('path');
const {app, BrowserWindow} = require('electron');

const OUT = path.join(__dirname, '..', 'assets');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function svg(strokeWidth) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b8cff"/>
      <stop offset="1" stop-color="#8a5bff"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>
  <g transform="translate(40 40) scale(7.33)" fill="none" stroke="#fff" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>
    <path d="M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>
    <path d="M6 12c1-5 5-8 10-8-2 2-3 4-3 8"/>
  </g>
</svg>
`;
}

function strokeFor(size) {
    if (size <= 20) return 2.8;
    if (size <= 32) return 2.4;
    return 2;
}

/** ICO container with embedded PNGs (supported since Windows Vista). */
function buildIco(images) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    const entries = [];
    let offset = 6 + 16 * images.length;
    for (const {size, png} of images) {
        const e = Buffer.alloc(16);
        e.writeUInt8(size >= 256 ? 0 : size, 0);
        e.writeUInt8(size >= 256 ? 0 : size, 1);
        e.writeUInt8(0, 2);
        e.writeUInt8(0, 3);
        e.writeUInt16LE(1, 4);
        e.writeUInt16LE(32, 6);
        e.writeUInt32LE(png.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += png.length;
        entries.push(e);
    }
    return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

async function render(win, size) {
    const src = `data:image/svg+xml;base64,${Buffer.from(svg(strokeFor(size))).toString('base64')}`;
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = c.height = ${size};
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, ${size}, ${size});
            resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('SVG konnte nicht geladen werden'));
        img.src = ${JSON.stringify(src)};
    })`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
}

app.whenReady().then(async () => {
    try {
        const win = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true}});
        await win.loadURL('data:text/html,<!doctype html><title>icons</title>');
        fs.mkdirSync(OUT, {recursive: true});
        fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(2));
        fs.writeFileSync(path.join(OUT, 'icon.png'), await render(win, 512));
        const images = [];
        for (const size of ICO_SIZES) images.push({size, png: await render(win, size)});
        fs.writeFileSync(path.join(OUT, 'icon.ico'), buildIco(images));
        process.stdout.write(`Icons geschrieben nach ${OUT}\n`);
        app.exit(0);
    } catch (err) {
        process.stderr.write(`${err.stack || err}\n`);
        app.exit(1);
    }
});
