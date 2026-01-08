/**
 * @fileoverview Background service worker for managing state and downloads.
 * This script runs in the background and handles:
 * - Monitoring network requests for m3u8 files
 * - Storing captured manifests
 * - Managing background downloads that continue even when popup is closed
 * - Processing ZIP file creation
 */

// Load JSZip library
importScripts('jszip.min.js');

/**
 * Regular expression pattern to match m3u8 files in URLs.
 * Matches any .m3u8 file including master.m3u8, index-f*-v*-a*.m3u8, etc.
 * @type {RegExp}
 * @constant
 */
const M3U8_PATTERN = /\.m3u8(\?|$)/i;

/**
 * Array of captured manifest objects.
 * Each manifest contains: id, m3u8Url, m3u8Content, m3u8FileName, expectedSegments, capturedAt
 * @type {Array<Object>}
 */
let manifestHistory = [];

/**
 * Map tracking active downloads.
 * Key: downloadId (string), Value: download state object
 * @type {Map<string, {manifestId: string, format: string, cancelled: boolean, abortController: AbortController, progress: Object}>}
 */
let activeDownloads = new Map();

/**
 * Generates a unique ID for each manifest using timestamp and random string.
 * @returns {string} A unique identifier combining timestamp and random characters
 */
function generateManifestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

console.log('[Stream Video Saver] Background script loaded');
console.log('[Stream Video Saver] Starting continuous monitoring for m3u8 files...');

// Start monitoring automatically when extension loads
chrome.webRequest.onCompleted.addListener(
  handleRequestCompleted,
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

console.log('[Stream Video Saver] ✅ Continuous monitoring active');

/**
 * Message handler for communication with popup and content scripts.
 * Handles various actions: getStatus, getManifestData, clearManifest, startDownload, cancelDownload, getDownloadStatus
 * @param {Object} message - The message object containing action and optional parameters
 * @param {string} message.action - The action to perform
 * @param {chrome.runtime.MessageSender} sender - Information about the sender
 * @param {Function} sendResponse - Callback function to send response
 * @returns {boolean} Returns true to indicate async response handling
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`[Stream Video Saver] Background received message: ${message.action}`);

  if (message.action === 'getStatus') {
    // Filter out manifests with no segments and remove duplicates
    // Group by URL (without query params) and keep only the most recent one
    const seen = new Map();
    const filtered = manifestHistory
      .filter(m => m.expectedSegments.length > 0) // Only include manifests with segments
      .map(m => ({
        id: m.id,
        fileName: m.m3u8FileName,
        url: m.m3u8Url,
        segmentCount: m.expectedSegments.length,
        capturedAt: m.capturedAt,
        urlKey: m.m3u8Url.split('?')[0] // URL without query params for deduplication
      }))
      .filter(m => {
        // Keep only the most recent manifest for each unique URL
        const existing = seen.get(m.urlKey);
        if (!existing || new Date(m.capturedAt) > new Date(existing.capturedAt)) {
          if (existing) {
            // Remove the older one
            seen.delete(m.urlKey);
          }
          seen.set(m.urlKey, m);
          return true;
        }
        return false;
      })
      .map(m => ({
        id: m.id,
        fileName: m.fileName,
        url: m.url,
        segmentCount: m.segmentCount,
        capturedAt: m.capturedAt
      }))
      // Sort by capturedAt in descending order (most recent first)
      .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

    console.log(`[Stream Video Saver] getStatus: returning ${filtered.length} manifests (filtered from ${manifestHistory.length} total, removed ${manifestHistory.length - filtered.length} with no segments or duplicates)`);
    console.log(`[Stream Video Saver] Manifest IDs: ${filtered.map(m => m.id).join(', ')}`);
    sendResponse({
      manifestHistory: filtered
    });
    return true; // Indicate we will send a response
  } else if (message.action === 'getManifestData') {
    // Get data for a specific manifest by ID
    const manifest = manifestHistory.find(m => m.id === message.manifestId);
    if (manifest) {
      sendResponse({
        id: manifest.id,
        m3u8Url: manifest.m3u8Url,
        m3u8Content: manifest.m3u8Content,
        m3u8FileName: manifest.m3u8FileName,
        expectedSegments: manifest.expectedSegments
      });
    } else {
      sendResponse({ error: 'Manifest not found' });
    }
  } else if (message.action === 'clearManifest') {
    // Clear a specific manifest or all manifests
    if (message.manifestId) {
      manifestHistory = manifestHistory.filter(m => m.id !== message.manifestId);
      console.log(`[Stream Video Saver] ✅ Manifest cleared: ${message.manifestId}. Remaining: ${manifestHistory.length}`);
    } else {
      manifestHistory = [];
      console.log('[Stream Video Saver] ✅ All manifests cleared');
    }
    sendResponse({ success: true });
  } else if (message.action === 'segmentDownloaded') {
    // Track that a segment was downloaded (for progress tracking only)
    const segmentUrl = message.segmentUrl;
    console.log(`[Stream Video Saver] 📥 Segment downloaded: ${segmentUrl}`);

    // Find the manifest this segment belongs to (if we track it)
    // For now, just acknowledge
    sendResponse({
      success: true
    });
  } else if (message.action === 'startDownload') {
    // Start a download in the background
    const { manifestId, format } = message;
    startDownload(manifestId, format);
    sendResponse({ success: true });
  } else if (message.action === 'cancelDownload') {
    // Cancel an ongoing download
    const { downloadId } = message;
    cancelDownload(downloadId);
    sendResponse({ success: true });
  } else if (message.action === 'getDownloadStatus') {
    // Get status of ongoing downloads
    const statuses = Array.from(activeDownloads.entries()).map(([id, download]) => ({
      downloadId: id,
      manifestId: download.manifestId,
      format: download.format,
      progress: download.progress || { downloaded: 0, total: 0, status: 'starting' }
    }));
    sendResponse({ downloads: statuses });
  }
  return true;
});

/**
 * Parses an m3u8 playlist file and extracts segment URLs.
 * Handles absolute URLs, relative URLs, and URLs with query parameters.
 * @param {string} content - The m3u8 file content as a string
 * @param {string} baseUrl - The base URL of the m3u8 file (used for resolving relative URLs)
 * @returns {Array<string>} Array of absolute segment URLs
 */
function parseM3U8(content, baseUrl) {
  console.log(`[Stream Video Saver] Parsing m3u8, baseUrl: ${baseUrl}`);
  const lines = content.split('\n');
  const segmentUrls = [];

  if (!baseUrl) {
    console.warn('[Stream Video Saver] No baseUrl provided for parsing');
    return segmentUrls;
  }

  // Parse base URL - handle query parameters
  const baseUrlWithoutQuery = baseUrl.split('?')[0];
  const base = new URL(baseUrlWithoutQuery);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
  console.log(`[Stream Video Saver] Base origin: ${base.origin}`);
  console.log(`[Stream Video Saver] Base path: ${basePath}`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    // This is a URL line (any non-comment, non-empty line)
    // Could be a segment file (.ts, .m4s, etc.) or another m3u8 file
    if (line && !line.startsWith('#')) {
      let segmentUrl;

      // Handle absolute URLs (with or without query parameters)
      if (line.startsWith('http://') || line.startsWith('https://')) {
        segmentUrl = line;
      } else if (line.startsWith('/')) {
        // Absolute path from root
        segmentUrl = base.origin + line;
      } else {
        // Relative path - combine with base path
        segmentUrl = base.origin + basePath + line;
      }

      // Only log first few segments to avoid console spam
      if (segmentUrls.length < 3) {
        console.log(`[Stream Video Saver] Found segment/manifest: ${line} -> ${segmentUrl}`);
      }
      segmentUrls.push(segmentUrl);
    }
  }

  console.log(`[Stream Video Saver] Total segments/manifests parsed: ${segmentUrls.length}`);
  return segmentUrls;
}


/**
 * Set of URLs that have been recently processed to prevent duplicate processing.
 * @type {Set<string>}
 */
const recentlyProcessed = new Set();

/**
 * Cooldown period in milliseconds before a URL can be processed again.
 * @type {number}
 * @constant
 */
const PROCESSING_COOLDOWN = 5000; // 5 seconds cooldown for same URL

/**
 * Handles completed network requests and captures m3u8 files.
 * Filters for VOD playlists only, fetches content, parses segments, and stores in manifest history.
 * @param {chrome.webRequest.WebRequestBodyDetails} details - Details about the completed request
 * @returns {Promise<void>}
 */
async function handleRequestCompleted(details) {
  const url = details.url;

  // Check if it's an m3u8 file
  if (!M3U8_PATTERN.test(url)) {
    return;
  }

  const urlWithoutQuery = url.split('?')[0];

  // Skip if we've processed this URL recently (cooldown period)
  if (recentlyProcessed.has(urlWithoutQuery)) {
    return; // Silently skip - already processed recently
  }

  // Check if we already have this exact manifest in history
  const existingManifest = manifestHistory.find(m => {
    const existingUrlWithoutQuery = m.m3u8Url.split('?')[0];
    return existingUrlWithoutQuery === urlWithoutQuery;
  });

  if (existingManifest) {
    // Already have it, skip processing
    return;
  }

  // Mark as being processed
  recentlyProcessed.add(urlWithoutQuery);

  // Remove from cooldown set after cooldown period
  setTimeout(() => {
    recentlyProcessed.delete(urlWithoutQuery);
  }, PROCESSING_COOLDOWN);

  console.log(`[Stream Video Saver] ✓ M3U8 file detected (new): ${url}`);

  try {
    // Fetch the m3u8 content using the extension's context (bypasses CORS)
    console.log(`[Stream Video Saver] Fetching m3u8 content from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Stream Video Saver] Failed to fetch m3u8: ${response.status} ${response.statusText}`);
      return;
    }

    const text = await response.text();
    console.log(`[Stream Video Saver] M3U8 content length: ${text.length} chars`);
    console.log(`[Stream Video Saver] M3U8 content preview (first 500 chars): ${text.substring(0, 500)}`);

    // Extract filename for display
    const urlObj = new URL(url.split('?')[0]);
    const pathParts = urlObj.pathname.split('/');
    const fileName = pathParts[pathParts.length - 1] || 'manifest.m3u8';

    // Only process VOD (Video On Demand) playlists - skip master playlists and live streams
    if (!text.includes('#EXT-X-PLAYLIST-TYPE:VOD')) {
      console.log(`[Stream Video Saver] Skipping non-VOD manifest: ${fileName} (missing #EXT-X-PLAYLIST-TYPE:VOD)`);
      return;
    }

    // Parse and store expected segment URLs immediately
    const segmentUrls = parseM3U8(text, url);

    // Only add to history if it has segments (additional safety check)
    if (segmentUrls.length === 0) {
      console.log(`[Stream Video Saver] Skipping manifest with no segments: ${fileName}`);
      return;
    }

    // Double-check we don't already have this (race condition protection)
    const duplicateCheck = manifestHistory.find(m => {
      const existingUrlWithoutQuery = m.m3u8Url.split('?')[0];
      return existingUrlWithoutQuery === urlWithoutQuery;
    });

    if (duplicateCheck) {
      console.log(`[Stream Video Saver] Duplicate detected during processing, skipping: ${fileName}`);
      return;
    }

    // Create manifest object and add to history
    const manifestId = generateManifestId();
    const manifest = {
      id: manifestId,
      m3u8Url: url,
      m3u8Content: text,
      m3u8FileName: fileName,
      expectedSegments: segmentUrls,
      capturedAt: new Date().toISOString()
    };

    manifestHistory.push(manifest);

    console.log(`[Stream Video Saver] ✅ M3U8 captured and added to history: ${fileName}`);
    console.log(`[Stream Video Saver] 📋 Found ${segmentUrls.length} segments`);
    console.log(`[Stream Video Saver] 📚 Total manifests in history: ${manifestHistory.length}`);

    if (segmentUrls.length > 0) {
      console.log(`[Stream Video Saver] First few segments: ${segmentUrls.slice(0, 3)}`);
    }

    // Notify popup that a new manifest is available
    chrome.runtime.sendMessage({
      action: 'manifestCaptured',
      manifestId: manifestId,
      fileName: fileName,
      segmentCount: segmentUrls.length
    }).catch(() => {}); // Ignore if no listeners
  } catch (error) {
    console.error(`[Stream Video Saver] Error fetching m3u8: ${error.message}`, error);
  }
}

/**
 * Starts a download in the background script.
 * Creates a download ID, sets up abort controller, and initiates the appropriate download format.
 * @param {string} manifestId - The ID of the manifest to download
 * @param {string} format - The download format ('zip' or 'mp4')
 * @returns {Promise<void>}
 */
async function startDownload(manifestId, format) {
  const downloadId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const abortController = new AbortController();

  // Find the manifest
  const manifest = manifestHistory.find(m => m.id === manifestId);
  if (!manifest) {
    notifyDownloadError(downloadId, 'Manifest not found');
    return;
  }

  // Store download state
  activeDownloads.set(downloadId, {
    manifestId,
    format,
    cancelled: false,
    abortController,
    progress: { downloaded: 0, total: 0, status: 'starting' }
  });

  try {
    if (format === 'zip') {
      await downloadAsZip(downloadId, manifest, abortController.signal);
    } else if (format === 'mp4') {
      notifyDownloadError(downloadId, 'MP4 conversion must be done in popup due to SharedArrayBuffer limitations');
      activeDownloads.delete(downloadId);
      return;
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      notifyDownloadError(downloadId, error.message);
    }
    activeDownloads.delete(downloadId);
  }
}

/**
 * Cancels an ongoing download.
 * Marks download as cancelled, aborts fetch requests, and removes from active downloads.
 * @param {string} downloadId - The ID of the download to cancel
 * @returns {void}
 */
function cancelDownload(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (download) {
    download.cancelled = true;
    download.abortController.abort();
    notifyDownloadProgress(downloadId, {
      downloaded: download.progress.downloaded,
      total: download.progress.total,
      status: 'cancelled'
    });
    activeDownloads.delete(downloadId);
  }
}

/**
 * Downloads video segments and packages them into a ZIP file.
 * Downloads segments in batches, creates ZIP archive, and triggers browser download.
 * @param {string} downloadId - Unique identifier for this download
 * @param {Object} manifest - The manifest object containing m3u8 data and segment URLs
 * @param {string} manifest.m3u8Url - The URL of the m3u8 file
 * @param {string} manifest.m3u8Content - The content of the m3u8 file
 * @param {string} manifest.m3u8FileName - The filename of the m3u8 file
 * @param {AbortSignal} signal - AbortSignal to cancel the download
 * @returns {Promise<void>}
 * @throws {Error} If JSZip is not loaded or no segments are found
 */
async function downloadAsZip(downloadId, manifest, signal) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip library not loaded');
  }

  const zip = new JSZip();

  // Modify m3u8 content to use local filenames
  const modifiedM3U8Content = modifyM3U8ForLocalFiles(manifest.m3u8Content, manifest.m3u8Url);

  // Add m3u8 file
  const m3u8FileName = manifest.m3u8Url.substring(manifest.m3u8Url.lastIndexOf('/') + 1).split('?')[0];
  zip.file(m3u8FileName, modifiedM3U8Content);

  // Create and add bash script for converting to MP4
  const scriptTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFileName = m3u8FileName.replace('.m3u8', '') || 'output';
  const bashScriptContent = `#!/usr/bin/env bash
# Convert m3u8 playlist to MP4 using ffmpeg
# Usage: ./convert_to_mp4.sh

MANIFEST_FILE="${m3u8FileName}"
OUTPUT_FILE="${outputFileName}-${scriptTimestamp}.mp4"

ffmpeg -i "$MANIFEST_FILE" -c copy "$OUTPUT_FILE"
if [[ $? -ne 0 ]]; then
  echo "Conversion failed"
  exit 1
fi

echo "Conversion complete: $OUTPUT_FILE"
echo "Cleaning up segments..."
rm -f *.ts
`;
  zip.file('convert_to_mp4.sh', bashScriptContent);

  // Parse m3u8 to get segment URLs
  const segmentUrls = parseM3U8(manifest.m3u8Content, manifest.m3u8Url);

  if (segmentUrls.length === 0) {
    throw new Error('No segments found in m3u8 file');
  }

  const total = segmentUrls.length;
  let downloaded = 0;

  // Update initial progress
  notifyDownloadProgress(downloadId, {
    downloaded: 0,
    total,
    status: 'downloading'
  });

  // Download segments in batches
  const batchSize = 5;
  for (let i = 0; i < segmentUrls.length; i += batchSize) {
    // Check if cancelled
    if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
      throw new Error('Download cancelled');
    }

    const batch = segmentUrls.slice(i, i + batchSize);

    await Promise.all(batch.map(async (url) => {
      if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
        return;
      }

      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();

        // Extract filename
        let fileName;
        try {
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
          } else {
            fileName = url.split('?')[0].split('/').pop();
          }
          fileName = fileName.split('?')[0];
        } catch (error) {
          fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
        }

        if (!fileName) {
          throw new Error('Could not extract filename from URL');
        }

        zip.file(fileName, blob);
        downloaded++;

        // Update progress
        const download = activeDownloads.get(downloadId);
        if (download) {
          download.progress = { downloaded, total, status: 'downloading' };
        }
        notifyDownloadProgress(downloadId, {
          downloaded,
          total,
          status: 'downloading'
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          throw error;
        }
        console.error(`[Stream Video Saver] Error downloading segment ${url}:`, error);
      }
    }));
  }

  // Check if cancelled before creating zip
  if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
    throw new Error('Download cancelled');
  }

  // Generate zip file
  notifyDownloadProgress(downloadId, {
    downloaded,
    total,
    status: 'creating_zip'
  });

  // Generate ZIP as ArrayBuffer (service workers don't support Blob/URL.createObjectURL)
  const zipArrayBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });

  // Check if cancelled before downloading
  if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
    throw new Error('Download cancelled');
  }

  // Convert ArrayBuffer to base64 data URL for chrome.downloads API
  // Use chunked conversion to avoid stack overflow with large files
  const bytes = new Uint8Array(zipArrayBuffer);
  let binary = '';
  const chunkSize = 8192; // Process in 8KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  const base64 = btoa(binary);
  const dataUrl = `data:application/zip;base64,${base64}`;

  // Create download using chrome.downloads API
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zipFileName = `${manifest.m3u8FileName.replace('.m3u8', '')}-${timestamp}.zip`;

  chrome.downloads.download({
    url: dataUrl,
    filename: zipFileName,
    saveAs: true
  }, (chromeDownloadId) => {
    if (chrome.runtime.lastError) {
      notifyDownloadError(downloadId, chrome.runtime.lastError.message);
      activeDownloads.delete(downloadId);
    } else {
      notifyDownloadProgress(downloadId, {
        downloaded,
        total,
        status: 'complete'
      });
      // Clean up after a short delay
      setTimeout(() => {
        activeDownloads.delete(downloadId);
      }, 2000);
    }
  });
}

/**
 * Modifies m3u8 content to use local filenames instead of full URLs.
 * Extracts just the filename from each segment URL line while preserving comments and metadata.
 * @param {string} content - The original m3u8 file content
 * @param {string} baseUrl - The base URL of the m3u8 file (used for parsing relative URLs)
 * @returns {string} Modified m3u8 content with local filenames
 */
function modifyM3U8ForLocalFiles(content, baseUrl) {
  const lines = content.split('\n');
  const modifiedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Keep comments and empty lines as-is
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      modifiedLines.push(line);
      continue;
    }

    // This is a segment URL line - extract just the filename
    try {
      let filename;

      // If it's a full URL, parse it
      if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
        const url = new URL(trimmedLine);
        const pathParts = url.pathname.split('/');
        filename = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
      } else if (trimmedLine.startsWith('/')) {
        const pathParts = trimmedLine.split('/');
        filename = pathParts[pathParts.length - 1];
      } else {
        filename = trimmedLine.split('?')[0].split('/').pop();
      }

      if (!filename) {
        modifiedLines.push(line);
        continue;
      }

      filename = filename.split('?')[0];
      modifiedLines.push(filename);
    } catch (error) {
      modifiedLines.push(line);
    }
  }

  return modifiedLines.join('\n');
}

/**
 * Sends download progress update to the popup.
 * @param {string} downloadId - The ID of the download
 * @param {Object} progress - Progress information object
 * @param {number} progress.downloaded - Number of segments downloaded
 * @param {number} progress.total - Total number of segments
 * @param {string} progress.status - Current status ('starting' | 'downloading' | 'creating_zip' | 'complete' | 'cancelled')
 * @returns {void}
 */
function notifyDownloadProgress(downloadId, progress) {
  chrome.runtime.sendMessage({
    action: 'downloadProgress',
    downloadId,
    ...progress
  }).catch(() => {}); // Ignore if no listeners
}

/**
 * Sends download error notification to the popup.
 * @param {string} downloadId - The ID of the download that failed
 * @param {string} error - Error message describing what went wrong
 * @returns {void}
 */
function notifyDownloadError(downloadId, error) {
  chrome.runtime.sendMessage({
    action: 'downloadError',
    downloadId,
    error
  }).catch(() => {}); // Ignore if no listeners
}

