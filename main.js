const { app, BrowserWindow, session } = require('electron');
const osu = require('os-utils');
const fs = require('fs');
const path = require('path');

// Path to the `config/` folder and `config.json`
const CONFIG_DIR = path.join(__dirname, 'config');

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
    RENDERER_OVERLOAD_CHECK: true, // Check renderer for high CPU usage
    RELOAD_TIMER: 0, // Reload site every X seconds (0 means disabled) (only if your surfbar stuck sometimes)
    OVERLOAD_ENABLED: true, // Enable or disable the system overload monitoring
    OVERLOAD_WARNING_CPU: 50, // Warning for CPU usage in %
    OVERLOAD_WARNING_RAM: 50, // Warning for RAM usage in %
    OVERLOAD_THRESHOLD_CPU: 90, // Threshold for CPU usage in %
    OVERLOAD_THRESHOLD_RAM: 90, // Threshold for RAM usage in %
    OVERLOAD_CHECK_INTERVAL: 5, // Check interval in seconds (e.g., every 5 seconds)
    OVERLOAD_EXCEED_LIMIT: 3, // Number of consecutive exceedances before taking action
};
let browserConfig = {
    disableSiteIsolationTrials: true,
    disableGpuProcessPrelaunch: true,
    disableRendererBackgrounding: true,
    enableLowEndDeviceMode: true,
    disableAccelerated2DCanvas: true,
    disableHardwareAcceleration: true,
    disableSoftwareRasterizer: true,
    disableGpu: true,
    disableGpuCompositing: true,
    rendererProcessLimit: 4
}
// DO NOT EDIT - Overwritten by config file

const colors = {
    reset: '\x1b[0m',  // Zurücksetzen der Farbe
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    brightBlack: '\x1b[90m',  // Helles Schwarz (oft als Grau interpretiert)
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m'
};
function colorize(text, color) {
    // Check if the text is an object (including arrays) and not null
    if (typeof text === 'object' && text !== null) {
        // If it is an object or array, convert it to a formatted JSON string
        text = JSON.stringify(text, null, 2);
    }
    // Apply the color and reset sequence, then return the formatted text
    return `${color}${text}${colors.reset}`;
}

// Load configuration from `config.json`
function loadConfig(file, target) {
    try {
        const filePath = path.join(CONFIG_DIR, file);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            const parsedConfig = JSON.parse(data);
            target = { ...target, ...parsedConfig };
            console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Settings from',colors.green)} ${colorize(file,colors.cyan)} ${colorize('loaded:',colors.green)}`);
            console.log(colorize(target,colors.blue));
        } else {
            console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Settings file',colors.red)} ${colorize(file,colors.cyan)} ${colorize('not found, using default values:',colors.red)}`);
            console.log(colorize(target,colors.blue));
        }
    } catch (ignore) {
        console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Settings file',colors.red)} ${colorize(file,colors.cyan)} ${colorize('not found, using default values:',colors.red)}`);
        console.log(colorize(target,colors.blue));
    }
}

// Load initial configuration
loadConfig('config.json',config);
loadConfig('browser_deep_config.json',browserConfig);

// Default User-Agent (if `user_agent.txt` is missing)
let userAgent = null;

// Load User-Agent from `config/user_agent.txt`
function loadUserAgent() {
    try {
        const ua = fs.readFileSync(path.join(CONFIG_DIR, 'user_agent.txt'), 'utf-8').trim();
        if (ua && ua.length > 0) {
            userAgent = ua;
            console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('User-Agent from',colors.green)} ${colorize('user_agent.txt',colors.cyan)} ${colorize('loaded:',colors.green)}`);
            console.log(colorize(userAgent,colors.blue));
        } else {
            console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Could not load',colors.red)} ${colorize('user_agent.txt',colors.cyan)} ${colorize(', using default User-Agent.',colors.red)}`);
        }
    } catch (error) {
        console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Could not load',colors.red)} ${colorize('user_agent.txt',colors.cyan)} ${colorize(', using default User-Agent.',colors.red)}`);
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
        console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Loaded',colors.green)} ${colorize(targetSet.size,colors.cyan)} ${colorize('entries from',colors.green)} ${colorize(filename,colors.cyan)}${colorize(':',colors.green)}`);
        console.log(colorize(Array.from(targetSet),colors.blue));
    } catch (error) {
        console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Could not load',colors.red)} ${colorize(filename,colors.cyan)}${colorize('.',colors.red)}`);
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

app.commandLine.appendSwitch('disable-logging'); //disable chromium logs

// Optimize process settings
if (browserConfig.disableSiteIsolationTrials) {
    app.commandLine.appendSwitch('disable-site-isolation-trials');
}
if (browserConfig.disableGpuProcessPrelaunch) {
    app.commandLine.appendSwitch('disable-gpu-process-prelaunch');
}
if (browserConfig.disableRendererBackgrounding) {
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
}
if (browserConfig.enableLowEndDeviceMode) {
    app.commandLine.appendSwitch('enable-low-end-device-mode');
}
if (browserConfig.disableAccelerated2DCanvas) {
    app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
}
if (browserConfig.disableHardwareAcceleration) {
    app.disableHardwareAcceleration();
}
if (browserConfig.disableSoftwareRasterizer) {
    app.commandLine.appendSwitch('disable-software-rasterizer');
}
if (browserConfig.disableGpu) {
    app.commandLine.appendSwitch('disable-gpu');
}
if (browserConfig.disableGpuCompositing) {
    app.commandLine.appendSwitch('disable-gpu-compositing');
}
if (typeof browserConfig.rendererProcessLimit === 'number' && browserConfig.rendererProcessLimit > 0) {
    app.commandLine.appendSwitch('renderer-process-limit', browserConfig.rendererProcessLimit.toString());
}

// Helper function to extract domain from URL
function getDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace(/^www\./, ''); // removes "www."
    } catch (error) {
        return 'unknown';
    }
}

// Custom logger to prepend domain to log messages
function createLogger(win) {
    return (message,color) => {
        const domain = getDomain(win.webContents.getURL());
        if(domain !== 'unknown')
            console.log(`${colorize('['+domain+']',colors.magenta)} ${colorize(message,color)}`);
        else
            console.log(`${colorize('[Unknown]',colors.magenta)} ${colorize(message,color)}`);
    };
}

function monitorRenderer() {
    setInterval(() => {
        try {
            const metrics = app.getAppMetrics();
            const highCpuProcesses = metrics.filter(metric =>
                metric.type === 'renderer' && metric.cpu && metric.cpu.percentCPUUsage > 90
            );

            if (highCpuProcesses.length > 0) {
                console.log( `${colorize('[Surfer]', colors.magenta)} ${colorize('High CPU usage detected in renderer process(es):', colors.yellow)}`);
                console.log(`${colorize(highCpuProcesses,colors.blue)}`)

                const allWindows = BrowserWindow.getAllWindows();

                highCpuProcesses.forEach(process => {
                    const targetWindow = allWindows.find(win =>
                        win.webContents.getProcessId() === process.pid
                    );

                    if (targetWindow) {
                        console.log(
                            `${colorize('[Surfer]', colors.magenta)} ${colorize(`Reloading window with PID: ${process.pid}`, colors.red)}`
                        );
                        targetWindow.reload();
                    }
                });
            }
        } catch (error) {
            console.log(
                `${colorize('[Surfer]', colors.magenta)} ${colorize(`Error checking process metrics: ${error}`, colors.red)}`
            );
        }
    }, 5000);
}

let exceedCount = 0;
function monitorSystemPerformance() {
    setInterval(() => {
        osu.cpuUsage((cpu) => {
            // Calculate CPU and RAM usage in percentage
            let cpuUsage = (cpu * 100).toFixed(2); // CPU usage in %
            let ramUsage = ((1 - osu.freememPercentage()) * 100).toFixed(2); // RAM usage in %

            // Check if CPU or RAM usage exceeds the WARNING level
            if (cpuUsage > config.OVERLOAD_WARNING_CPU || ramUsage > config.OVERLOAD_WARNING_RAM) {
                console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Attention: System-CPU: '+cpuUsage+'% | System-RAM: '+ramUsage+'%)',colors.yellow)}`);
            }

            // Check if CPU or RAM usage exceeds the CRITICAL THRESHOLD
            if (cpuUsage > config.OVERLOAD_THRESHOLD_CPU || ramUsage > config.OVERLOAD_THRESHOLD_RAM) {
                // Increment the exceedCount if the threshold is exceeded
                exceedCount++;
                console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Warning: '+exceedCount+'/'+config.OVERLOAD_EXCEED_LIMIT+' - System overload detected.', colors.yellow)}`);
            } else {
                // Reset the counter if usage falls below the critical threshold
                exceedCount = 0;
            }

            // If exceedCount reaches the limit, reload all windows
            if (exceedCount >= config.OVERLOAD_EXCEED_LIMIT) {
                console.log(`${colorize('[Surfer]',colors.magenta)} ${colorize('Threshold exceeded! Reloading all windows.',colors.red)}`);
                BrowserWindow.getAllWindows().forEach(win => win.reload());
                exceedCount = 0; // Reset the counter after reloading
            }
        });
    }, config.OVERLOAD_CHECK_INTERVAL * 1000); // Check interval in milliseconds
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
                logger(`Reloading page after ${config.RELOAD_TIMER} seconds...`, colors.green);
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
                        logger(`Blocked deeply nested iframe (Depth: ${frameDepth}): ${url}`,colors.brightBlack);
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
                        logger(`Blocked media content based on Content-Type: ${url}`,colors.brightBlack);
                        return callback({cancel: true});
                    }
                }
            }

            if(config.BLOCK_DOMAINS) {
                // Block blacklisted domains
                if ([...blockedDomains].some(domain => url.includes(domain))) {
                    logger(`Blocked domain from blacklist: ${url}`,colors.brightBlack);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_EXTENSIONS) {
                // Block specific file extensions
                if ([...blockedExtensions].some(ext => url.endsWith(ext))) {
                    logger(`Blocked file extension: ${url}`,colors.brightBlack);
                    return callback({cancel: true});
                }
            }

            // Allow all other requests
            callback({ cancel: false, responseHeaders: details.responseHeaders });
        });

        win.webContents.on('page-title-updated', (event, title) => {
            logger(`Update: ${title}`,colors.green);
        });

        win.webContents.setWindowOpenHandler((details) => {
            if(config.BLOCK_NOT_WHITELISTED_POPUPS) {
                let senderFrame = details.referrer;
                if (!senderFrame) {
                    logger(`Blocked pop-up from unknown Sender to: ${details.url}`,colors.brightBlack);
                    return {action: 'deny'};
                }

                let senderDomain = getDomain(senderFrame.url);

                if (whitelistDomains.has(senderDomain)) {
                    return {action: 'allow'};
                } else {
                    logger(`Blocked pop-up from ${senderDomain} to: ${details.url}`, colors.brightBlack);
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
                    logger(`Blocked navigation from ${currentDomain} to: ${newURL}`,colors.brightBlack);
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
                        logger(`Blocked deeply nested iframe (Depth: ${frameDepth}): ${url}`,colors.brightBlack);
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
                    logger(`Blocked media content (Audio/Video): ${url}`,colors.brightBlack);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_DOMAINS) {
                // Block requests from blacklisted domains
                if ([...blockedDomains].some(domain => url.includes(domain))) {
                    logger(`Blocked domain from blacklist: ${url}`, colors.brightBlack);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_EXTENSIONS) {
                // Block specific file extensions
                if ([...blockedExtensions].some(ext => url.endsWith(ext))) {
                    logger(`Blocked file extension: ${url}`,colors.brightBlack);
                    return callback({cancel: true});
                }
            }

            if(config.BLOCK_OTHER_URL_TYPES) {
                // Block specific URL types like blob:, base64:, and WebSockets
                if (url.startsWith('blob:') || url.includes('base64,') || url.includes('wss://') || url.includes('rtcpeerconnection')) {
                    logger(`Blocked special URL type: ${url}`,colors.brightBlack);
                    return callback({cancel: true});
                }
            }

            // Allow all other requests
            callback({ cancel: false });
        });

        win.webContents.session.on('will-download', (event, item) => {
            if (config.BLOCK_DOWNLOADS) {
                logger(`Blocked download: ${item.getURL()}`,colors.brightBlack);
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
        console.log(`${colorize('[Surfer]',colors.magenta)} Please add your surf links in "config/surfbar_links.txt" and restart.`);
    }

    if(config.OVERLOAD_ENABLED) {
        monitorSystemPerformance(); // Starting System-Monitoring
    }

    if(config.RENDERER_OVERLOAD_CHECK) {
        monitorRenderer();  // Starting Renderer-Monitoring
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    console.log(`${colorize('[System]', colors.magenta)} ${colorize('Application is quitting...',colors.green)}`);
    BrowserWindow.getAllWindows().forEach(win => {
        win.close();
    });
});

process.on('uncaughtException', (error) => {
    console.log(
        `${colorize('[System]', colors.magenta)} ${colorize(`Uncaught Exception: ${error}`, colors.red)}`
    );
});

process.on('unhandledRejection', (reason, promise) => {
    console.log(
        `${colorize('[System]', colors.magenta)} ${colorize(`Unhandled Rejection at: ${promise}`, colors.yellow)} ${colorize('Reason:', colors.yellow)} ${colorize(reason, colors.red)}`
    );
});
