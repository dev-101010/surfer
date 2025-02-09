#!/bin/sh

# Set the desired path where main.js is located
PROJECT_PATH="$(dirname "$0")"

# Change to the correct directory
cd "$PROJECT_PATH" || { echo "Error: Directory not found!"; exit 1; }

# Check if Electron is installed
if ! command -v electron &> /dev/null; then
    echo "Electron not found, attempting to install..."
    npm install -g electron
fi

# Start Electron with main.js
npx electron main.js

# Pause for Linux/macOS (optional, keeps terminal open)
echo "Press Enter to exit..."
read
