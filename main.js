const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

// Path to the `config/` folder and `config.json`
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Default configuration values
// DO NOT EDIT - Overwritten by config file
let config = {
    MAX_IFRAME_DEPTH: 3,  // Maximum allowed iframe nesting depth
    JS_CHECK_ENABLED: true, // Enable or disable additional JavaScript checks
    BLOCK_DOWNLOADS: true, // Enable or disable download block
    BLOCK_MEDIA: true, // Enable or disable media block
    BLOCK_OTHER_URL_TYPES: true, // Enable or disable blocking of other URL types ( e.g. wss:// )
    ALLOW_WHITELIST: true, // Enable or disable whitelisted domains
    BLOCK_DOMAINS: true, // Enable or disable blocked domains
    BLOCK_EXTENSIONS: true, // Enable or disable blocked extensions
    BLOCK_NAVIGATION_TO_OTHER_DOMAINS: true, // Block navigation in window to other domains
    BLOCK_NOT_WHITELISTED_POPUPS: true, // Block popups from not whitelisted domains
    RELOAD_TIMER: 0 // Reload site every X seconds (0 means disabled) (only if your surfbar stuck sometimes)
};
// DO NOT EDIT - Overwritten by config file

// Load configuration from `config.json`
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const parsedConfig = JSON.parse(data);
            config = { ...config, ...parsedConfig };
            console.log('[Surfer] Config loaded:', config);
        } else {
            console.warn('[Surfer] Config file not found, using default values.');
        }
    } catch (error) {
        console.error('[Surfer] Error loading config file:', error);
    }
}

// Load initial configuration
loadConfig();

// Default User-Agent (if `user_agent.txt` is missing)
let userAgent = null;

// Load User-Agent from `config/user_agent.txt`
function loadUserAgent() {
    try {
        const ua = fs.readFileSync(path.join(CONFIG_DIR, 'user_agent.txt'), 'utf-8').trim();
        if (ua && ua.length > 0) {
            userAgent = ua;
            console.log(`[Surfer] Loaded User-Agent from config/user_agent.txt`);
        } else {
            console.warn(`[Surfer] Could not load user_agent.txt, using default User-Agent.`);
        }
    } catch (error) {
        console.warn(`[Surfer] Could not load user_agent.txt, using default User-Agent.`);
    }
}

// Load domain lists and start URL from respective config files
function loadFromFile(filename, targetSet) {
    try {
        const data = fs.readFileSync(path.join(CONFIG_DIR, filename), 'utf-8').split(/\r?\n/);
        targetSet.clear();
        for (let line of data) {
            let domain = line.trim().toLowerCase();
            if (domain) targetSet.add(domain);
        }
        console.log(`[Surfer] Loaded ${targetSet.size} entries from config/${filename}`);
    } catch (error) {
        console.error(`[Surfer] Error loading config/${filename}:`, error);
    }
}

// Load initial configuration files
loadUserAgent();
let blockedDomains = new Set();
let blockedExtensions = new Set();
let whitelistDomains = new Set();
let startURLs = new Set();
loadFromFile('blocked_domains.txt', blockedDomains);
loadFromFile('blocked_extensions.txt', blockedExtensions);
loadFromFile('whitelist.txt', whitelistDomains);
loadFromFile('surfbar_links.txt', startURLs);

// Optimize process settings
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

// Helper function to extract domain from URL
function getDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (error) {
        return 'unknown';
    }
}

// Custom logger to prepend domain to log messages
function createLogger(win) {
    return (message) => {
        const domain = getDomain(win.webContents.getURL());
        if(domain !== 'unknown')
            console.log(`[${domain}] ${message}`);
        else
            console.log(`[Surfer] ${message}`);
    };
}

app.whenReady().then(() => {
    // Create a new BrowserWindow for each URL in startURLs
    startURLs.forEach(url => {

        let win = new BrowserWindow({
            width: 1280, height: 720, backgroundThrottling: true, webPreferences: {
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

        const logger = createLogger(win);

        // Set up the reload timer if RELOAD_TIMER is greater than 0
        if (config.RELOAD_TIMER > 0) {
            setInterval(() => {
                logger(`Reloading page after ${config.RELOAD_TIMER} seconds...`);
                win.webContents.reload();
            }, config.RELOAD_TIMER * 1000);
        }

        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const url = details.url.toLowerCase();

            if(config.MAX_IFRAME_DEPTH > 0) {
                // Block iframes deeper than the allowed depth
                if (details.resourceType === 'subFrame') {
                    let frameDepth = details.frameAncestors ? details.frameAncestors.length : 0;
                    if (frameDepth >= config.MAX_IFRAME_DEPTH) {
                        logger(`Blocked deeply nested iframe (Depth: ${frameDepth}): ${url}`);
                        return callback({cancel: true});
                    }
                }
            }

            if(config.ALLOW_WHITELIST) {
                // Allow only whitelisted domains
                if ([...whitelistDomains].some(domain => url.includes(domain))) {
                    return callback({cancel: false, responseHeaders: details.responseHeaders});
                }
            }

            if(config.BLOCK_MEDIA) {
                // Block audio and video content based on Content-Type header
                if (details.responseHeaders && details.responseHeaders['content-type']) {
                    let contentType = details.responseHeaders['content-type'][0].toLowerCase();
                    if (contentType.includes('video') || contentType.includes('audio')) {
                        logger(`Blocked media content based on Content-Type: ${url}`);
                        return callback({cancel: true});
                    }
                }
            }

            if(config.BLOCK_DOMAINS) {
                // Block blacklisted domains
                if ([...blockedDomains].some(domain => url.includes(domain))) {
                    logger(`Blocked domain from blacklist: ${url}`);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_EXTENSIONS) {
                // Block specific file extensions
                if ([...blockedExtensions].some(ext => url.endsWith(ext))) {
                    logger(`Blocked file extension: ${url}`);
                    return callback({cancel: true});
                }
            }

            // Allow all other requests
            callback({ cancel: false, responseHeaders: details.responseHeaders });
        });

        win.webContents.on('page-title-updated', (event, title) => {
            logger(`Update: ${title}`);
        });

        win.webContents.setWindowOpenHandler((details) => {
            if(config.BLOCK_NOT_WHITELISTED_POPUPS) {
                let senderFrame = details.referrer;
                if (!senderFrame) {
                    logger(`Blocked pop-up from unknown Sender to: ${details.url}`);
                    return {action: 'deny'};
                }

                let senderDomain = getDomain(senderFrame.url);

                if (whitelistDomains.has(senderDomain)) {
                    return {action: 'allow'};
                } else {
                    logger(`Blocked pop-up from ${senderDomain} to: ${details.url}`);
                    return {action: 'deny'};
                }
            }
            return {action: 'allow'};
        });

        win.webContents.on('will-navigate', (event, newURL) => {
            if(config.BLOCK_NAVIGATION_TO_OTHER_DOMAINS) {
                let currentDomain = getDomain(win.webContents.getURL());
                let targetDomain = getDomain(newURL);
                if (currentDomain !== "unknown" && currentDomain !== targetDomain) {
                    logger(`Blocked navigation from ${currentDomain} to: ${newURL}`);
                    event.preventDefault();
                }
            }
        });

        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            const url = details.url.toLowerCase();

            if(config.MAX_IFRAME_DEPTH > 0) {
                // Block iframes deeper than the allowed depth
                if (details.resourceType === 'subFrame') {
                    let frameDepth = details.frameAncestors ? details.frameAncestors.length : 0;
                    if (frameDepth >= config.MAX_IFRAME_DEPTH) {
                        logger(`Blocked deeply nested iframe (Depth: ${frameDepth}): ${url}`);
                        return callback({cancel: true});
                    }
                }
            }

            if(config.ALLOW_WHITELIST) {
                // Allow only whitelisted domains
                if ([...whitelistDomains].some(domain => url.includes(domain))) {
                    return callback({cancel: false});
                }
            }

            if(config.BLOCK_MEDIA) {
                // Block audio and video content before it loads
                if (['media', 'object'].includes(details.resourceType)) {
                    logger(`Blocked media content (Audio/Video): ${url}`);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_DOMAINS) {
                // Block requests from blacklisted domains
                if ([...blockedDomains].some(domain => url.includes(domain))) {
                    logger(`Blocked domain from blacklist: ${url}`);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_EXTENSIONS) {
                // Block specific file extensions
                if ([...blockedExtensions].some(ext => url.endsWith(ext))) {
                    logger(`Blocked file extension: ${url}`);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_OTHER_URL_TYPES) {
                // Block specific URL types like blob:, base64:, and WebSockets
                if (url.startsWith('blob:') || url.includes('base64,') || url.includes('wss://') || url.includes('rtcpeerconnection')) {
                    logger(`Blocked special URL type: ${url}`);
                    return callback({cancel: true});
                }
            }

            // Allow all other requests
            callback({ cancel: false });
        });

        win.webContents.session.on('will-download', (event, item) => {
            if (config.BLOCK_DOWNLOADS) {
                logger(`Blocked download: ${item.getURL()}`);
                event.preventDefault();
            }
        });

        // Inject JavaScript to monitor iframe depth and media elements
        if (config.JS_CHECK_ENABLED) {
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
                    function blockElements() {
                        document.querySelectorAll('iframe, video, audio').forEach(el => {
                            if (el.tagName === 'IFRAME' && getIframeDepth(el) > ${config.MAX_IFRAME_DEPTH}) {
                                console.warn("Blocked deeply nested iframe:", el.src);
                                el.remove();
                            } else if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
                                el.style.visibility = 'hidden';
                                el.pause();
                                el.remove();
                            }
                        });
                    }
                    setInterval(blockElements, 1000);
                `).then();
            });
        }

        // Set a custom user agents
        if(userAgent && userAgent.length > 0) {
            win.webContents.setUserAgent(userAgent);
        }

        // Load the URL in the window
        win.loadURL(url).then();
    });

    // If no URLs are provided, show a notice
    if (startURLs.size === 0) {
        console.error(`Please add your surf links in "config/surfbar_links.txt" and restart.`);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    console.log('Application is quitting...');
    BrowserWindow.getAllWindows().forEach(win => {
        win.close();
    });
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});