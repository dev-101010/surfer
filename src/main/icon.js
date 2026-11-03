'use strict';

const path = require('path');
const {nativeImage} = require('electron');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const ICON_PNG = path.join(ASSETS, 'icon.png');
// Windows picks the matching size (16 px title bar, 32 px+ taskbar) from the .ico
const ICON_FILE = process.platform === 'win32' ? path.join(ASSETS, 'icon.ico') : ICON_PNG;

let cached = null;

/** Application icon as NativeImage, or undefined if the file is missing (Electron default then). */
function appIcon() {
    if (cached === null) {
        const img = nativeImage.createFromPath(ICON_FILE);
        cached = img.isEmpty() ? undefined : img;
    }
    return cached;
}

module.exports = {appIcon, ICON_PNG};
