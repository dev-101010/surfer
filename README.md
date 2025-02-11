# Surfer v0.01

Surfer is a simple Script for NodeJS that uses Electron to start a custom Browser for your Surfbars.

Compatible with **Windows**, **Linux**, and **macOS**.

---

## Installation

### Step 1: Install Node.js
Make sure you have **Node.js** installed on your system. If not, download and install it from the official website:

👉 [Download Node.js](https://nodejs.org/en/download)

---

### Step 2: Download the Project
Download the project as a ZIP file from GitHub:

👉 [Download ZIP](https://github.com/dev-101010/surfer/archive/refs/heads/master.zip)

---

### Step 3: Unzip the Files
Extract the downloaded ZIP file to a directory of your choice.

---

### Step 4: Configure Surfbar Link
1. Navigate to the `config` directory.
2. Open the `surfbar_links.txt` file.
3. Add your Surfbar links to the file and save it. (line by line)

---

### Step 5: Configure Surfer (Optional)

1. Navigate to the `config` directory.
2. Open the `config.json` file.
3. Modify the settings carefully.

#### Default Configuration

Below are the default settings available in `config.json`:
```json
{
  "MAX_IFRAME_DEPTH": 3, // Maximum allowed iframe nesting depth
  "JS_CHECK_ENABLED": true, // Enable or disable additional JavaScript checks
  "BLOCK_DOWNLOADS": true, // Enable or disable download blocking
  "BLOCK_MEDIA": true, // Enable or disable media blocking
  "BLOCK_OTHER_URL_TYPES": true, // Enable or disable blocking of other URL types ( e.g. wss:// )
  "ALLOW_WHITELIST": true, // Enable or disable whitelisted domains
  "BLOCK_DOMAINS": true, // Enable or disable blocked domains
  "BLOCK_EXTENSIONS": true, // Enable or disable blocked extensions
  "BLOCK_NAVIGATION_TO_OTHER_DOMAINS": true, // Block navigation to other domains
  "BLOCK_NOT_WHITELISTED_POPUPS": true, // Block popups from non-whitelisted domains
  "RELOAD_TIMER": 0 // Reload site every X seconds (0 means disabled) (only if your surfbar stuck sometimes)
}
```

Below are the browser deep settings available in `browser_deep_config.json`:
```json
{
  "disableSiteIsolationTrials": true,
  "disableGpuProcessPrelaunch": true,
  "disableRendererBackgrounding": true,
  "enableLowEndDeviceMode": true,
  "disableAccelerated2DCanvas": true,
  "disableHardwareAcceleration": true,
  "disableSoftwareRasterizer": true,
  "disableGpu": true,
  "disableGpuCompositing": true,
  "rendererProcessLimit": 4
}
```

---

## Usage

### Windows
1. Open the extracted directory.
2. Double-click on `start.bat` to run the script.
3. If asked, allow to execute.

### Linux and macOS
1. Open a terminal and navigate to the extracted directory.
2. Run the following command to execute the script:
   ###### First start, make executable:
   ```bash
   chmod +x start.sh
   ```
   ###### Start:
   ```bash
   ./start.sh
    ```


![surfer](https://github.com/user-attachments/assets/48deb44e-daf6-4263-8b38-f903db49e32d)
