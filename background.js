// Background service worker for managing state and downloads

// Match any .m3u8 file - master.m3u8, index-f*-v*-a*.m3u8, or any other m3u8 file
const M3U8_PATTERN = /\.m3u8(\?|$)/i;

let capturedData = {
  m3u8Url: null,
  m3u8Content: null,
  m3u8FileName: null, // Just the filename for display
  expectedSegments: [], // URLs of segments expected from m3u8
  downloadedSegments: new Set() // Track which segments have been downloaded
};

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
  console.log('[Stream Video Saver] Background received message:', message.action);

  if (message.action === 'getStatus') {
    const segmentCount = capturedData.expectedSegments.length;
    const downloadedCount = capturedData.downloadedSegments.size;
    sendResponse({
      m3u8Url: capturedData.m3u8Url,
      m3u8FileName: capturedData.m3u8FileName,
      segmentCount: segmentCount,
      downloadedCount: downloadedCount,
      hasManifest: !!capturedData.m3u8Url
    });
  } else if (message.action === 'getCapturedData') {
    sendResponse(getCapturedData());
  } else if (message.action === 'clearManifest') {
    console.log('[Stream Video Saver] Clearing manifest data...');
    capturedData.m3u8Url = null;
    capturedData.m3u8Content = null;
    capturedData.m3u8FileName = null;
    capturedData.expectedSegments = [];
    capturedData.downloadedSegments.clear();
    console.log('[Stream Video Saver] ✅ Manifest data cleared');
    sendResponse({ success: true });
  } else if (message.action === 'segmentDownloaded') {
    // Track that a segment was downloaded (for progress tracking only)
    const segmentUrl = message.segmentUrl;
    console.log('[Stream Video Saver] 📥 Segment downloaded:', segmentUrl);

    capturedData.downloadedSegments.add(segmentUrl);
    const downloadedCount = capturedData.downloadedSegments.size;
    const totalCount = capturedData.expectedSegments.length;

    console.log('[Stream Video Saver] Download progress:', downloadedCount, '/', totalCount);

    sendResponse({
      success: true,
      downloaded: downloadedCount,
      total: totalCount
    });
  }
  return true;
});

function parseM3U8(content, baseUrl) {
  console.log('[Stream Video Saver] Parsing m3u8, baseUrl:', baseUrl);
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
  console.log('[Stream Video Saver] Base origin:', base.origin);
  console.log('[Stream Video Saver] Base path:', basePath);

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
        console.log('[Stream Video Saver] Found segment/manifest:', line, '->', segmentUrl);
      }
      segmentUrls.push(segmentUrl);
    }
  }

  console.log('[Stream Video Saver] Total segments/manifests parsed:', segmentUrls.length);
  return segmentUrls;
}

// Get captured data for popup to process
function getCapturedData() {
  console.log('[Stream Video Saver] getCapturedData triggered');
  return {
    m3u8Url: capturedData.m3u8Url,
    m3u8Content: capturedData.m3u8Content,
    m3u8FileName: capturedData.m3u8FileName
  };
}

// Handle completed network requests
async function handleRequestCompleted(details) {
  const url = details.url;

  // Only log m3u8 requests to reduce console spam
  // Uncomment the line below to see all requests for debugging
  // console.log('[Stream Video Saver] Request completed:', url);

  // Check if it's an m3u8 file
  if (M3U8_PATTERN.test(url)) {
    console.log('[Stream Video Saver] ✓ M3U8 file detected:', url);

    // Only capture if we haven't captured this one yet
    // Compare URLs without query parameters for comparison
    const urlWithoutQuery = url.split('?')[0];
    const capturedUrlWithoutQuery = capturedData.m3u8Url ? capturedData.m3u8Url.split('?')[0] : null;

    if (capturedUrlWithoutQuery === urlWithoutQuery) {
      console.log('[Stream Video Saver] Already captured this m3u8 file');
      return;
    }

    try {
      // Fetch the m3u8 content using the extension's context (bypasses CORS)
      console.log('[Stream Video Saver] Fetching m3u8 content from:', url);
      const response = await fetch(url);
      if (!response.ok) {
        console.error('[Stream Video Saver] Failed to fetch m3u8:', response.status, response.statusText);
        return;
      }

      const text = await response.text();
      console.log('[Stream Video Saver] M3U8 content length:', text.length, 'chars');
      console.log('[Stream Video Saver] M3U8 content preview (first 500 chars):', text.substring(0, 500));

      // Extract filename for display
      const urlObj = new URL(url.split('?')[0]);
      const pathParts = urlObj.pathname.split('/');
      const fileName = pathParts[pathParts.length - 1] || 'manifest.m3u8';

      // Store the URL with query parameters for later use
      capturedData.m3u8Url = url;
      capturedData.m3u8Content = text;
      capturedData.m3u8FileName = fileName;

      // Parse and store expected segment URLs immediately
      const segmentUrls = parseM3U8(text, url);
      capturedData.expectedSegments = segmentUrls;
      capturedData.downloadedSegments.clear(); // Reset download tracking

      console.log('[Stream Video Saver] ✅ M3U8 captured:', fileName);
      console.log('[Stream Video Saver] 📋 Found', segmentUrls.length, 'segments');

      if (segmentUrls.length > 0) {
        console.log('[Stream Video Saver] First few segments:', segmentUrls.slice(0, 3));
      } else {
        console.warn('[Stream Video Saver] ⚠️ No segments found in m3u8 file');
      }

      // Notify popup that a new manifest is available
      chrome.runtime.sendMessage({
        action: 'manifestCaptured',
        fileName: fileName,
        segmentCount: segmentUrls.length
      }).catch(() => {}); // Ignore if no listeners
    } catch (error) {
      console.error('[Stream Video Saver] Error fetching m3u8:', error);
      console.error('[Stream Video Saver] Error details:', error.message, error.stack);
    }
  }
}

