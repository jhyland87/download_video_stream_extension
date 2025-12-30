// Background service worker for managing state and downloads

// Match any .m3u8 file - master.m3u8, index-f*-v*-a*.m3u8, or any other m3u8 file
const M3U8_PATTERN = /\.m3u8(\?|$)/i;

// Store multiple manifests in a history list
let manifestHistory = []; // Array of manifest objects

// Helper to create a unique ID for each manifest
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

// Listen for messages from content script or popup
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
      }));

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
  }
  return true;
});

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


// Track recently processed URLs to prevent duplicate processing
const recentlyProcessed = new Set();
const PROCESSING_COOLDOWN = 5000; // 5 seconds cooldown for same URL

// Handle completed network requests
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

