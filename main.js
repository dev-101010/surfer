const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

// 📌 Maximale erlaubte Iframe-Tiefe
const MAX_IFRAME_DEPTH = 3;

// 📌 Pfad zum `config/`-Ordner
const CONFIG_DIR = path.join(__dirname, 'config');

// 📌 Standard-User-Agent (falls `user_agent.txt` fehlt)
let userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

// 📌 User-Agent aus `config/user_agent.txt` laden
function loadUserAgent() {
    try {
        const ua = fs.readFileSync(path.join(CONFIG_DIR, 'user_agent.txt'), 'utf-8').trim();
        if (ua) {
            userAgent = ua;
            console.log(`Loaded User-Agent from config/user_agent.txt: ${userAgent}`);
        }
    } catch (error) {
        console.warn(`Could not load user_agent.txt, using default User-Agent.`);
    }
}

// 📌 Blocklisten & Start-URL laden
function loadDomainsFromFile(filename, targetSet) {
    try {
        const data = fs.readFileSync(path.join(CONFIG_DIR, filename), 'utf-8').split(/\r?\n/);
        targetSet.clear();
        for (let line of data) {
            let domain = line.trim().toLowerCase();
            if (domain) targetSet.add(domain);
        }
        console.log(`Loaded ${targetSet.size} entries from config/${filename}`);
    } catch (error) {
        console.error(`Error loading config/${filename}:`, error);
    }
}

function loadStartURL() {
    try {
        const url = fs.readFileSync(path.join(CONFIG_DIR, 'surfbar_link.txt'), 'utf-8').trim();
        if (url) startURL = url;
        console.log(`Loaded start URL from config/surfbar_link.txt: ${startURL}`);
    } catch (error) {
        console.error(`Error loading config/surfbar_link.txt:`, error);
    }
}

// 📌 Initiale Ladung der Dateien
loadUserAgent();
let blockedDomains = new Set();
let blockedExtensions = new Set();
let whitelistDomains = new Set();
let startURL = 'https://www.example.com';
loadDomainsFromFile('blocked_domains.txt', blockedDomains);
loadDomainsFromFile('blocked_extensions.txt', blockedExtensions);
loadDomainsFromFile('whitelist.txt', whitelistDomains);
loadStartURL();

// 📌 Prozess-Optimierung für Laptops
app.commandLine.appendSwitch('renderer-process-limit', '4');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-gpu-process-prelaunch');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-low-end-device-mode');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

app.whenReady().then(() => {
    let win = new BrowserWindow({
        width: 1280,
        height: 720,
        backgroundThrottling: true,
        webPreferences: {
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            autoplayPolicy: 'document-user-activation-required',
            disableBlinkFeatures: "MediaStream,EncryptedMedia",
            siteInstance: true,
            enableRemoteModule: false
        }
    });

    // 📌 Setze den User-Agent für alle Anfragen
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = userAgent;
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // 📌 Blockiere Downloads
    session.defaultSession.on('will-download', (event, item) => {
        console.log(`Download blocked: ${item.getFilename()}`);
        event.preventDefault();
    });

    // 📌 Iframes tiefer als MAX_IFRAME_DEPTH blockieren (onHeadersReceived)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        if (details.resourceType === 'subFrame') {
            let frameDepth = details.frameAncestors ? details.frameAncestors.length : 0;
            if (frameDepth >= MAX_IFRAME_DEPTH) {
                console.warn(`Blocked deeply nested iframe (depth: ${frameDepth}): ${details.url}`);
                return callback({ cancel: true });
            }
        }
		if (details.responseHeaders['content-type']) {
			let contentType = details.responseHeaders['content-type'][0].toLowerCase();
			if (contentType.includes('video') || contentType.includes('audio')) {
				console.log(`Blockiere durch MIME-Type: ${details.url}`);
				return callback({ cancel: true }); // Blockiert alle Video-/Audio-Inhalte
			}
		}
        callback({ cancel: false });
    });
	
	win.webContents.on('page-title-updated', (event, title) => {
		console.log(`Update: ${title}`);
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		if ([...whitelistDomains].some(domain => url.includes(domain))) {
			return { action: 'allow' }; // Erlaubt nur Whitelist-Domains
		}

		console.warn(`Blockiere neues Fenster: ${url}`);
			return { action: 'deny' }; // Blockiert das Öffnen neuer Fenster
		});

	win.webContents.on('will-navigate', (event, url) => {
		console.warn(`Navigation prevented: ${url}`);
		event.preventDefault(); // Verhindert Navigation außerhalb der erlaubten URL
	});

    // 📌 Iframes tiefer als MAX_IFRAME_DEPTH direkt in onBeforeRequest blockieren
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = details.url.toLowerCase();
		
		if ([...whitelistDomains].some(domain => url.includes(domain))) return callback({ cancel: false });

        if (details.resourceType === 'subFrame') {
            let frameDepth = details.frameAncestors ? details.frameAncestors.length : 0;
            if (frameDepth >= MAX_IFRAME_DEPTH) {
                console.warn(`Request blocked for deeply nested iframe (depth: ${frameDepth}): ${url}`);
                return callback({ cancel: true });
            }
        }

		if (['media'].includes(details.resourceType)) {
			console.log(`Blockiere Medien: ${details.url}`);
			return callback({ cancel: true }); // Blockiert Audio- und Video-Anfragen
		}

        if (url.startsWith('blob:') || url.includes('base64,') || url.includes('wss://') || url.includes('rtcpeerconnection')) {
            return callback({ cancel: true });
        }

        if ([...blockedDomains].some(domain => url.includes(domain))) {
            return callback({ cancel: true });
        }

        if ([...blockedExtensions].some(ext => url.endsWith(ext))) {
            return callback({ cancel: true });
        }

        callback({ cancel: false });
    });

    /* 📌 Medien-Blockade bleibt aktiv
    win.webContents.once('did-finish-load', () => {
		win.webContents.executeJavaScript(`
            function getIframeDepth(iframe) {
                let depth = 0;
                while (iframe) {
                    depth++;
                    iframe = iframe.parentElement.closest("iframe");
                }
                return depth;
            }

            function blockDeepIframes() {
                document.querySelectorAll('iframe').forEach(iframe => {
                    if (getIframeDepth(iframe) > 3) {
                        console.warn("Blocked deeply nested iframe:", iframe.src);
                        iframe.remove(); // Iframe entfernen
                    }
                });
            }

            function blockMediaElements() {
                document.querySelectorAll('video, audio').forEach(el => {
                    el.style.visibility = 'hidden';
                    el.pause();
                });
            }

            setInterval(() => {
                blockDeepIframes(); // Alle 10s prüfen
                blockMediaElements();
            }, 10000);

            new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.tagName === 'IFRAME' && getIframeDepth(node) > 3) {
                            console.warn("Blocked deeply nested iframe:", node.src);
                            node.remove();
                        }
                    });
                });
            }).observe(document.body, { childList: true, subtree: true });
        `);
        win.webContents.executeJavaScript(`
            function blockMediaElements() {
                document.querySelectorAll('video, audio').forEach(el => {
                    el.style.visibility = 'hidden';
                    el.pause();
					el.remove();
                });
            }
            setInterval(blockMediaElements, 10000);
        `);
    });*/

    // 📌 Lade die Start-URL aus `config/surfbar_link.txt`
    win.loadURL(startURL);
});
