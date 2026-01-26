> [!NOTE]
> FYI - This is mostly just to see how well I can get AI to develop an app/extension from scratch. Very few lines are actually written by me. 

# Stream Video Saver Chrome Extension

A Chrome extension that captures HLS stream m3u8 files and their associated segment files, then packages them into a ZIP file for download.


![Alt text for the image](assets/demo.gif)


## Features

- Automatically detects and captures `index-f*-v*-a*.m3u8` manifest files
- Intercepts network requests to capture m3u8 files and segment files
- Parses m3u8 files to extract all segment URLs
- Downloads all segments and packages them into a ZIP file
- Simple popup interface to start/stop capturing and download

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select this extension directory

## Usage

1. Navigate to a page that loads HLS video streams
2. Click the extension icon to open the popup
3. Click "Start Capturing" to begin monitoring network requests
4. Wait for the m3u8 file and segments to be captured (the status will update)
5. Click "Download as ZIP" to download all captured files as a ZIP archive
6. The browser will prompt you to save the ZIP file

## How It Works

- The extension uses a content script to intercept `fetch` and `XMLHttpRequest` calls
- When an m3u8 file matching the pattern `index-f*-v*-a*.m3u8` is detected, it captures the file content
- The m3u8 file is parsed to extract all segment URLs (files matching `seg-*-f*-v*-a*.ts`)
- When you click "Download as ZIP", the extension:
  - Downloads all segments listed in the m3u8 file
  - Packages the m3u8 file and all segments into a ZIP file
  - Prompts you to save the ZIP file

## File Structure

- `manifest.json` - Extension manifest
- `background.js` - Service worker for managing state
- `content.js` - Content script to intercept network requests
- `popup.html` - Popup UI
- `popup.js` - Popup logic and ZIP creation
- `icon*.png` - Extension icons (16x16, 48x48, 128x128)

## Notes

- The extension requires internet access to download segment files
- Large videos may take some time to download all segments
- The extension captures files based on URL patterns, so it works with HLS streams that follow the naming convention `index-f*-v*-a*.m3u8` and `seg-*-f*-v*-a*.ts`
- Icons are placeholders and should be replaced with proper icons for production use

## Permissions

The extension requires the following permissions:
- `webRequest` - To monitor network requests
- `storage` - To store captured data
- `downloads` - To save the ZIP file
- `tabs` - To communicate with content scripts
- `activeTab` - To access the current tab
- `<all_urls>` - To intercept requests from any website

