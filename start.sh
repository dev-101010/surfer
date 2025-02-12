#!/bin/bash

# Set UTF-8 locale (only necessary if issues appear)
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Change directory to script location
cd "$(dirname "$0")"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install || exit 1
fi

# Start Electron
echo "Starting Electron..."
npx electron main.js

# Keep window open if Electron crashes or exits
echo
echo "Electron has been closed. Press any key to exit..."
read -n 1 -s -r