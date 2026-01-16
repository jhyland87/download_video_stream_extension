/**
 * @fileoverview Background service worker for managing state and downloads.
 * This script runs in the background and handles:
 * - Monitoring network requests for m3u8 files
 * - Storing captured manifests
 * - Managing background downloads that continue even when popup is closed
 * - Processing ZIP file creation
 */

// Types are available via global.d.ts
// JSZip will be loaded via importScripts in the bundled output

// Import message types for type annotations
import type {
  GetManifestDataMessage,
  ClearManifestMessage,
  SegmentDownloadedMessage,
  StartDownloadMessage,
  CancelDownloadMessage
} from './types/index.js';

/**
 * Regular expression pattern to match m3u8 files in URLs.
 * Matches any .m3u8 file including master.m3u8, index-f*-v*-a*.m3u8, etc.
 */
const M3U8_PATTERN = /\.m3u8(\?|$)/i;

const BATCH_SIZE = 10;

const RETRY_BATCH_SIZE = 5;

/**
 * Array of captured manifest objects.
 */
let manifestHistory: Manifest[] = [];

/**
 * Map tracking active downloads.
 */
let activeDownloads = new Map<string, ActiveDownload>();

/**
 * Generates a unique ID for each manifest using timestamp and random string.
 * @returns A unique identifier combining timestamp and random characters
 */
function generateManifestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

console.log('[Stream Video Saver] Background script loaded');
console.log('[Stream Video Saver] Starting continuous monitoring for m3u8 files...');

// Start monitoring automatically when extension loads
chrome.webRequest.onCompleted.addListener(
  (details: chrome.webRequest.WebResponseDetails) => {
    handleRequestCompleted(details as unknown as chrome.webRequest.WebRequestBodyDetails);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

console.log('[Stream Video Saver] ✅ Continuous monitoring active');

/**
 * Handles the 'getStatus' action by filtering and deduplicating manifests.
 * @param sendResponse - Function to send the response back
 */
function handleGetStatus(sendResponse: (response: ExtensionResponse) => void): void {
  // Filter out manifests with no segments and remove duplicates
  // Group by URL (without query params) OR (title + segment count) and keep only the most recent one
  const manifestsWithSegments = manifestHistory
    .filter((m) => m.expectedSegments.length > 0) // Only include manifests with segments
    .map((m) => ({
      id: m.id,
      fileName: m.m3u8FileName,
      title: m.title,
      url: m.m3u8Url,
      segmentCount: m.expectedSegments.length,
      capturedAt: m.capturedAt,
      resolution: m.resolution,
      duration: m.duration,
      urlKey: m.m3u8Url.split('?')[0], // URL without query params for deduplication
      dedupKey: m.title && m.expectedSegments.length > 0
        ? `${m.title}|${m.expectedSegments.length}` // Title + segment count for deduplication
        : m.m3u8Url.split('?')[0] // Fallback to URL if no title
    }));

  // Group by dedupKey and keep only the most recent one for each group
  const groupedByKey = new Map<string, ManifestSummary & { urlKey: string; dedupKey: string }>();
  for (const m of manifestsWithSegments) {
    const existing = groupedByKey.get(m.dedupKey);
    if (!existing || new Date(m.capturedAt) > new Date(existing.capturedAt)) {
      groupedByKey.set(m.dedupKey, m);
    }
  }

  // Convert map values to array and remove helper keys
  const filtered = Array.from(groupedByKey.values())
    .map((m) => ({
      id: m.id,
      fileName: m.fileName,
      title: m.title,
      url: m.url,
      segmentCount: m.segmentCount,
      capturedAt: m.capturedAt,
      resolution: m.resolution,
      duration: m.duration
    }))
    // Sort by capturedAt in descending order (most recent first)
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());

  console.log(`[Stream Video Saver] getStatus: returning ${filtered.length} manifests (filtered from ${manifestHistory.length} total, removed ${manifestHistory.length - filtered.length} with no segments or duplicates)`);
  console.log(`[Stream Video Saver] Manifest IDs: ${filtered.map((m) => m.id).join(', ')}`);
  const response: GetStatusResponse = {
    manifestHistory: filtered
  };
  sendResponse(response);
}

/**
 * Handles the 'getManifestData' action by retrieving manifest data by ID.
 * @param message - The getManifestData message
 * @param sendResponse - Function to send the response back
 */
function handleGetManifestData(message: GetManifestDataMessage, sendResponse: (response: ExtensionResponse) => void): void {
  // Get data for a specific manifest by ID
  const manifest = manifestHistory.find((m) => m.id === message.manifestId);
  if (manifest) {
    const response: GetManifestDataResponse = {
      id: manifest.id,
      m3u8Url: manifest.m3u8Url,
      m3u8Content: manifest.m3u8Content,
      m3u8FileName: manifest.m3u8FileName,
      expectedSegments: manifest.expectedSegments
    };
    sendResponse(response);
  } else {
    sendResponse({ error: 'Manifest not found' });
  }
}

/**
 * Handles the 'clearManifest' action by removing a manifest or all manifests.
 * @param message - The clearManifest message
 * @param sendResponse - Function to send the response back
 */
function handleClearManifest(message: ClearManifestMessage, sendResponse: (response: ExtensionResponse) => void): void {
  // Clear a specific manifest or all manifests
  if (message.manifestId) {
    manifestHistory = manifestHistory.filter((m) => m.id !== message.manifestId);
    console.log(`[Stream Video Saver] ✅ Manifest cleared: ${message.manifestId}. Remaining: ${manifestHistory.length}`);
  } else {
    manifestHistory = [];
    console.log('[Stream Video Saver] ✅ All manifests cleared');
  }
  const response: SuccessResponse = { success: true };
  sendResponse(response);
}

/**
 * Handles the 'segmentDownloaded' action (currently just acknowledges the message).
 * @param message - The segmentDownloaded message
 * @param sendResponse - Function to send the response back
 */
function handleSegmentDownloaded(message: SegmentDownloadedMessage, sendResponse: (response: ExtensionResponse) => void): void {
  // Track that a segment was downloaded (for progress tracking only)
  const segmentUrl = message.segmentUrl;
  console.log(`[Stream Video Saver] 📥 Segment downloaded: ${segmentUrl}`);

  // Find the manifest this segment belongs to (if we track it)
  // For now, just acknowledge
  const response: SuccessResponse = {
    success: true
  };
  sendResponse(response);
}

/**
 * Handles the 'startDownload' action by initiating a background download.
 * @param message - The startDownload message
 * @param sendResponse - Function to send the response back
 */
function handleStartDownload(message: StartDownloadMessage, sendResponse: (response: ExtensionResponse) => void): void {
  // Start a download in the background
  const { manifestId, format } = message;
  startDownload(manifestId, format).catch((error) => {
    console.error('[Stream Video Saver] Error starting download:', error);
  });
  const response: SuccessResponse = { success: true };
  sendResponse(response);
}

/**
 * Handles the 'cancelDownload' action by cancelling an ongoing download.
 * @param message - The cancelDownload message
 * @param sendResponse - Function to send the response back
 */
function handleCancelDownload(message: CancelDownloadMessage, sendResponse: (response: ExtensionResponse) => void): void {
  // Cancel an ongoing download
  const { downloadId } = message;
  cancelDownload(downloadId);
  const response: SuccessResponse = { success: true };
  sendResponse(response);
}

/**
 * Handles the 'getDownloadStatus' action by returning status of all ongoing downloads.
 * @param sendResponse - Function to send the response back
 */
function handleGetDownloadStatus(sendResponse: (response: ExtensionResponse) => void): void {
  // Get status of ongoing downloads
  const statuses = Array.from(activeDownloads.entries()).map(([id, download]) => ({
    downloadId: id,
    manifestId: download.manifestId,
    format: download.format,
    progress: download.progress || { downloaded: 0, total: 0, status: 'starting' as DownloadStatus }
  }));
  const response: GetDownloadStatusResponse = { downloads: statuses };
  sendResponse(response);
}

/**
 * Message handler for communication with popup and content scripts.
 * Routes messages to appropriate handler functions.
 */
chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionResponse) => void
): boolean => {
  console.log(`[Stream Video Saver] Background received message: ${message.action}`);

  switch (message.action) {
    case 'getStatus':
      handleGetStatus(sendResponse);
      return true; // Indicate we will send a response

    case 'getManifestData':
      handleGetManifestData(message as GetManifestDataMessage, sendResponse);
      return true;

    case 'clearManifest':
      handleClearManifest(message as ClearManifestMessage, sendResponse);
      return true;

    case 'segmentDownloaded':
      handleSegmentDownloaded(message as SegmentDownloadedMessage, sendResponse);
      return true;

    case 'startDownload':
      handleStartDownload(message as StartDownloadMessage, sendResponse);
      return true;

    case 'cancelDownload':
      handleCancelDownload(message as CancelDownloadMessage, sendResponse);
      return true;

    case 'getDownloadStatus':
      handleGetDownloadStatus(sendResponse);
      return true;

    default:
      console.warn(`[Stream Video Saver] Unknown message action: ${(message as { action: unknown }).action}`);
      return false;
  }
});

/**
 * Parses an m3u8 playlist file and extracts segment URLs.
 * Handles absolute URLs, relative URLs, and URLs with query parameters.
 * @param content - The m3u8 file content as a string
 * @param baseUrl - The base URL of the m3u8 file (used for resolving relative URLs)
 * @returns Array of absolute segment URLs
 */
function parseM3U8(content: string, baseUrl: string): string[] {
  console.log(`[Stream Video Saver] Parsing m3u8, baseUrl: ${baseUrl}`);
  const lines = content.split('\n');
  const segmentUrls: string[] = [];

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
      let segmentUrl: string;

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
 * Parses an m3u8 playlist file and extracts video resolution from #EXT-X-STREAM-INF tags.
 * @param content - The m3u8 file content as a string
 * @returns Video resolution if found, undefined otherwise
 */
function parseResolution(content: string): { width: number; height: number } | undefined {
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for #EXT-X-STREAM-INF tag with RESOLUTION attribute
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      // Format: #EXT-X-STREAM-INF:RESOLUTION=1920x1080,...
      const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      if (resolutionMatch && resolutionMatch[1] && resolutionMatch[2]) {
        const width = parseInt(resolutionMatch[1], 10);
        const height = parseInt(resolutionMatch[2], 10);
        if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
          return { width, height };
        }
      }
    }
  }

  return undefined;
}

/**
 * Parses an m3u8 playlist file and calculates total video duration by summing #EXTINF durations.
 * @param content - The m3u8 file content as a string
 * @returns Total duration in seconds if calculable, undefined otherwise
 */
function parseDuration(content: string): number | undefined {
  const lines = content.split('\n');
  let totalDuration = 0;
  let hasExtInf = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for #EXTINF tag
    // Format: #EXTINF:duration, or #EXTINF:duration,optional-title
    if (line.startsWith('#EXTINF:')) {
      hasExtInf = true;
      // Extract duration value (first number after the colon, before comma or end of line)
      const durationMatch = line.match(/^#EXTINF:([\d.]+)/);
      if (durationMatch && durationMatch[1]) {
        const duration = parseFloat(durationMatch[1]);
        if (!isNaN(duration) && duration > 0) {
          totalDuration += duration;
        }
      }
    }
  }

  // Only return duration if we found at least one #EXTINF tag
  return hasExtInf && totalDuration > 0 ? totalDuration : undefined;
}

/**
 * Parses an m3u8 playlist file and extracts initialization segment URLs from #EXT-X-MAP tags.
 * Handles absolute URLs, relative URLs, and URLs with query parameters.
 * @param content - The m3u8 file content as a string
 * @param baseUrl - The base URL of the m3u8 file (used for resolving relative URLs)
 * @returns Array of absolute initialization segment URLs
 */
function parseInitSegments(content: string, baseUrl: string): string[] {
  console.log(`[Stream Video Saver] Parsing m3u8 for init segments, baseUrl: ${baseUrl}`);
  const lines = content.split('\n');
  const initSegmentUrls: string[] = [];

  if (!baseUrl) {
    console.warn('[Stream Video Saver] No baseUrl provided for parsing init segments');
    return initSegmentUrls;
  }

  // Parse base URL - handle query parameters
  const baseUrlWithoutQuery = baseUrl.split('?')[0];
  const base = new URL(baseUrlWithoutQuery);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for #EXT-X-MAP tag
    if (line.startsWith('#EXT-X-MAP:')) {
      // Extract URI from the tag
      // Format: #EXT-X-MAP:URI="path/to/init.mp4"
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch && uriMatch[1]) {
        const uri = uriMatch[1];
        let initSegmentUrl: string;

        // Handle absolute URLs (with or without query parameters)
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
          initSegmentUrl = uri;
        } else if (uri.startsWith('/')) {
          // Absolute path from root
          initSegmentUrl = base.origin + uri;
        } else {
          // Relative path - combine with base path
          initSegmentUrl = base.origin + basePath + uri;
        }

        console.log(`[Stream Video Saver] Found init segment: ${uri} -> ${initSegmentUrl}`);
        initSegmentUrls.push(initSegmentUrl);
      }
    }
  }

  console.log(`[Stream Video Saver] Total init segments parsed: ${initSegmentUrls.length}`);
  return initSegmentUrls;
}

/**
 * Set of URLs that have been recently processed to prevent duplicate processing.
 */
const recentlyProcessed = new Set<string>();

/**
 * Cooldown period in milliseconds before a URL can be processed again.
 */
const PROCESSING_COOLDOWN = 5000; // 5 seconds cooldown for same URL

/**
 * Handles completed network requests and captures m3u8 files.
 * Filters for VOD playlists only, fetches content, parses segments, and stores in manifest history.
 * @param details - Details about the completed request
 */
async function handleRequestCompleted(details: chrome.webRequest.WebRequestBodyDetails): Promise<void> {
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
  const existingManifest = manifestHistory.find((m) => {
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

    // Parse resolution and duration from manifest
    const resolution = parseResolution(text);
    const duration = parseDuration(text);

    if (resolution) {
      console.log(`[Stream Video Saver] Found resolution: ${resolution.width}x${resolution.height}`);
    }
    if (duration) {
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      console.log(`[Stream Video Saver] Found duration: ${minutes}m ${seconds}s (${duration.toFixed(1)}s total)`);
    }

    // Try to get video title from the page (needed for duplicate detection)
    let title: string | undefined;

    // First, try to get video title from content script
    if (details.tabId && details.tabId > 0) {
      try {
        const videoTitleResponse = await chrome.tabs.sendMessage(details.tabId, { action: 'getVideoTitle' });
        if (videoTitleResponse && videoTitleResponse.title) {
          title = videoTitleResponse.title;
          console.log(`[Stream Video Saver] Found video title from content script: ${title}`);
        }
      } catch (error) {
        // Content script might not be available, continue to fallback
        console.log('[Stream Video Saver] Could not get video title from content script, trying tab title');
      }
    }

    // Fallback to tab title if video title not found
    if (!title && details.tabId && details.tabId > 0) {
      try {
        const tab = await chrome.tabs.get(details.tabId);
        if (tab && tab.title) {
          title = tab.title;
          console.log(`[Stream Video Saver] Using tab title: ${title}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[Stream Video Saver] Could not get tab title: ${errorMessage}`);
      }
    }

    // Check for duplicates: same URL OR (same title AND same segment count)
    // This check happens after title is fetched so we can properly detect title+segment duplicates
    const duplicateCheck = manifestHistory.find((m) => {
      const existingUrlWithoutQuery = m.m3u8Url.split('?')[0];
      const urlMatch = existingUrlWithoutQuery === urlWithoutQuery;

      // If we have a title and segment count, also check for title + segment match
      if (title && segmentUrls.length > 0) {
        const titleMatch = m.title === title;
        const segmentCountMatch = m.expectedSegments.length === segmentUrls.length;
        return urlMatch || (titleMatch && segmentCountMatch);
      }

      // Fallback to URL match only if no title
      return urlMatch;
    });

    if (duplicateCheck) {
      // Update existing manifest with newer data (keep most recent)
      console.log(`[Stream Video Saver] Duplicate detected, updating existing manifest: ${fileName}`);
      duplicateCheck.m3u8Url = url; // Update URL in case query params changed
      duplicateCheck.m3u8Content = text; // Update content
      duplicateCheck.m3u8FileName = fileName; // Update filename
      duplicateCheck.title = title || duplicateCheck.title; // Update title if we have a better one
      duplicateCheck.expectedSegments = segmentUrls; // Update segments
      duplicateCheck.capturedAt = new Date().toISOString(); // Update timestamp
      duplicateCheck.resolution = resolution || duplicateCheck.resolution; // Update resolution if available
      duplicateCheck.duration = duration || duplicateCheck.duration; // Update duration if available

      // Notify popup that manifest was updated
      chrome.runtime.sendMessage({
        action: 'manifestCaptured',
        manifestId: duplicateCheck.id,
        fileName: fileName,
        title: title,
        segmentCount: segmentUrls.length
      } as ExtensionMessage).catch(() => {
        // Ignore if no listeners
      });

      return;
    }

    // Create manifest object and add to history
    const manifestId = generateManifestId();
    const manifest: Manifest = {
      id: manifestId,
      m3u8Url: url,
      m3u8Content: text,
      m3u8FileName: fileName,
      title: title,
      expectedSegments: segmentUrls,
      capturedAt: new Date().toISOString(),
      resolution: resolution,
      duration: duration
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
      title: title,
      segmentCount: segmentUrls.length
    } as ExtensionMessage).catch(() => {
      // Ignore if no listeners
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Stream Video Saver] Error fetching m3u8: ${errorMessage}`, error);
  }
}

/**
 * Starts a download in the background script.
 * Creates a download ID, sets up abort controller, and initiates the ZIP download.
 * @param manifestId - The ID of the manifest to download
 * @param format - The download format (currently only 'zip' is supported)
 */
async function startDownload(manifestId: string, format: DownloadFormat): Promise<void> {
  const downloadId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const abortController = new AbortController();

  // Find the manifest
  const manifest = manifestHistory.find((m) => m.id === manifestId);
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
    } else {
      notifyDownloadError(downloadId, `Unsupported download format: ${format}`);
      activeDownloads.delete(downloadId);
      return;
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      notifyDownloadError(downloadId, errorMessage);
    }
    activeDownloads.delete(downloadId);
  }
}

/**
 * Cancels an ongoing download.
 * Marks download as cancelled, aborts fetch requests, and removes from active downloads.
 * @param downloadId - The ID of the download to cancel
 */
function cancelDownload(downloadId: string): void {
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
    // Clear badge if no active downloads remain
    if (activeDownloads.size === 0) {
      chrome.action.setBadgeText({ text: '' });
    }
  }
}

/**
 * Sanitizes a string for use as a filename by removing invalid characters and limiting length.
 * @param name - The string to sanitize
 * @param maxLength - Maximum length for the filename (default: 200)
 * @returns Sanitized filename-safe string
 */
function sanitizeFilename(name: string, maxLength: number = 200): string {
  // Remove or replace invalid filename characters
  let sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength).trim();
  }

  // If empty after sanitization, return a default
  if (!sanitized) {
    return 'video';
  }

  return sanitized;
}

/**
 * Downloads video segments and packages them into a ZIP file.
 * Downloads segments in batches, creates ZIP archive, and triggers browser download.
 * @param downloadId - Unique identifier for this download
 * @param manifest - The manifest object containing m3u8 data and segment URLs
 * @param signal - AbortSignal to cancel the download
 * @throws Error If JSZip is not loaded or no segments are found
 */
async function downloadAsZip(downloadId: string, manifest: Manifest, signal: AbortSignal): Promise<void> {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip library not loaded');
  }

  const zip = new JSZip();

  // Modify m3u8 content to use local filenames
  const modifiedM3U8Content = modifyM3U8ForLocalFiles(manifest.m3u8Content, manifest.m3u8Url);

  // Add m3u8 file (text file, no need for binary option)
  const m3u8FileName = manifest.m3u8Url.substring(manifest.m3u8Url.lastIndexOf('/') + 1).split('?')[0];
  zip.file(m3u8FileName, modifiedM3U8Content);

  // Create and add bash script for converting to MP4
  const scriptTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Use title if available, otherwise fall back to m3u8 filename
  const videoBaseName = manifest.title
    ? sanitizeFilename(manifest.title)
    : (m3u8FileName.replace('.m3u8', '') || 'output');
  const outputFileName = `${videoBaseName}-${scriptTimestamp}.mp4`;

  // Load template from file at runtime
  const templateUrl = chrome.runtime.getURL('templates/compile_video.sh.template');
  const templateResponse = await fetch(templateUrl);
  if (!templateResponse.ok) {
    throw new Error(`Failed to load template: ${templateResponse.status}`);
  }
  let bashScriptContent = await templateResponse.text();

  // Replace template placeholders with actual values
  bashScriptContent = bashScriptContent
    .replace('{{MANIFEST_FILE}}', m3u8FileName)
    .replace('{{OUTPUT_FILE}}', outputFileName);

  zip.file('compile_video.sh', bashScriptContent);

  // Parse m3u8 to get segment URLs
  const segmentUrls = parseM3U8(manifest.m3u8Content, manifest.m3u8Url);

  if (segmentUrls.length === 0) {
    throw new Error('No segments found in m3u8 file');
  }

  // Parse m3u8 to get initialization segment URLs from #EXT-X-MAP tags
  const initSegmentUrls = parseInitSegments(manifest.m3u8Content, manifest.m3u8Url);
  console.log(`[Stream Video Saver] Found ${initSegmentUrls.length} initialization segment(s)`);

  // Total includes both regular segments and init segments
  const total = segmentUrls.length + initSegmentUrls.length;
  let downloaded = 0;
  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  let downloadStartTime = Date.now();
  let lastUpdateTime = downloadStartTime;
  let lastDownloadedBytes = 0;

  // Track failed segments for retry
  const failedInitSegments: string[] = [];
  const failedSegments: string[] = [];

  // Update initial progress
  notifyDownloadProgress(downloadId, {
    downloaded: 0,
    total,
    status: 'downloading',
    downloadedBytes: 0,
    totalBytes: undefined,
    downloadSpeed: 0
  });

  // Download initialization segments first (if any)
  if (initSegmentUrls.length > 0) {
    console.log('[Stream Video Saver] Downloading initialization segments...');
    for (const url of initSegmentUrls) {
      if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
        throw new Error('Download cancelled');
      }

      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const blobSize = blob.size;
        downloadedBytes += blobSize;

        // Extract filename
        let fileName: string;
        try {
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'init.mp4';
          } else {
            const urlParts = url.split('?')[0].split('/');
            fileName = urlParts[urlParts.length - 1] || 'init.mp4';
          }
          fileName = fileName.split('?')[0];
        } catch (error) {
          fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0] || 'init.mp4';
        }

        if (!fileName) {
          throw new Error('Could not extract filename from init segment URL');
        }

        // Convert blob to ArrayBuffer for better memory efficiency with large files
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(fileName, arrayBuffer, { binary: true });
        downloaded++;

        // Calculate download speed
        const now = Date.now();
        const timeDelta = (now - lastUpdateTime) / 1000; // seconds
        let downloadSpeed = 0;
        if (timeDelta > 0) {
          const bytesDelta = downloadedBytes - lastDownloadedBytes;
          downloadSpeed = bytesDelta / timeDelta; // bytes per second
          lastUpdateTime = now;
          lastDownloadedBytes = downloadedBytes;
        }

        // Update progress
        const download = activeDownloads.get(downloadId);
        if (download) {
          download.progress = {
            downloaded,
            total,
            status: 'downloading',
            downloadedBytes,
            totalBytes,
            downloadSpeed
          };
        }
        notifyDownloadProgress(downloadId, {
          downloaded,
          total,
          status: 'downloading',
          downloadedBytes,
          totalBytes,
          downloadSpeed
        });

        console.log(`[Stream Video Saver] Downloaded init segment: ${fileName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Stream Video Saver] Failed to download init segment ${url}:`, errorMessage);
        // Track failed segment for retry instead of throwing immediately
        failedInitSegments.push(url);
      }
    }
  }

  // Download segments in batches
  for (let i = 0; i < segmentUrls.length; i += BATCH_SIZE) {
    // Check if cancelled
    if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
      throw new Error('Download cancelled');
    }

    const batch = segmentUrls.slice(i, i + BATCH_SIZE);

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
        const blobSize = blob.size;
        downloadedBytes += blobSize;

        // Extract filename
        let fileName: string;
        try {
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'segment.ts';
          } else {
            const urlParts = url.split('?')[0].split('/');
            fileName = urlParts[urlParts.length - 1] || 'segment.ts';
          }
          fileName = fileName.split('?')[0];
        } catch (error) {
          fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0] || 'segment.ts';
        }

        if (!fileName) {
          throw new Error('Could not extract filename from URL');
        }

        // Convert blob to ArrayBuffer for better memory efficiency with large files
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(fileName, arrayBuffer, { binary: true });
        downloaded++;

        // Calculate download speed
        const now = Date.now();
        const timeDelta = (now - lastUpdateTime) / 1000; // seconds
        let downloadSpeed = 0;
        if (timeDelta > 0) {
          const bytesDelta = downloadedBytes - lastDownloadedBytes;
          downloadSpeed = bytesDelta / timeDelta; // bytes per second
          lastUpdateTime = now;
          lastDownloadedBytes = downloadedBytes;
        }

        // Update progress
        const download = activeDownloads.get(downloadId);
        if (download) {
          download.progress = {
            downloaded,
            total,
            status: 'downloading',
            downloadedBytes,
            totalBytes,
            downloadSpeed
          };
        }
        notifyDownloadProgress(downloadId, {
          downloaded,
          total,
          status: 'downloading',
          downloadedBytes,
          totalBytes,
          downloadSpeed
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Stream Video Saver] Error downloading segment ${url}:`, errorMessage);
        // Track failed segment for retry instead of failing immediately
        failedSegments.push(url);
      }
    }));
  }

  // Retry failed init segments
  if (failedInitSegments.length > 0) {
    console.log(`[Stream Video Saver] Retrying ${failedInitSegments.length} failed init segment(s)...`);
    for (const url of failedInitSegments) {
      if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
        throw new Error('Download cancelled');
      }

      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const blobSize = blob.size;
        downloadedBytes += blobSize;

        // Extract filename
        let fileName: string;
        try {
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'init.mp4';
          } else {
            const urlParts = url.split('?')[0].split('/');
            fileName = urlParts[urlParts.length - 1] || 'init.mp4';
          }
          fileName = fileName.split('?')[0];
        } catch (error) {
          fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0] || 'init.mp4';
        }

        if (!fileName) {
          throw new Error('Could not extract filename from init segment URL');
        }

        // Convert blob to ArrayBuffer for better memory efficiency with large files
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(fileName, arrayBuffer, { binary: true });
        downloaded++;

        // Calculate download speed
        const now = Date.now();
        const timeDelta = (now - lastUpdateTime) / 1000; // seconds
        let downloadSpeed = 0;
        if (timeDelta > 0) {
          const bytesDelta = downloadedBytes - lastDownloadedBytes;
          downloadSpeed = bytesDelta / timeDelta; // bytes per second
          lastUpdateTime = now;
          lastDownloadedBytes = downloadedBytes;
        }

        // Update progress
        const download = activeDownloads.get(downloadId);
        if (download) {
          download.progress = {
            downloaded,
            total,
            status: 'downloading',
            downloadedBytes,
            totalBytes,
            downloadSpeed
          };
        }
        notifyDownloadProgress(downloadId, {
          downloaded,
          total,
          status: 'downloading',
          downloadedBytes,
          totalBytes,
          downloadSpeed
        });

        console.log(`[Stream Video Saver] Successfully retried init segment: ${fileName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Stream Video Saver] Failed to retry init segment ${url}:`, errorMessage);
        throw new Error(`Failed to download initialization segment after retry: ${errorMessage}`);
      }
    }
  }

  // Retry failed regular segments
  if (failedSegments.length > 0) {
    console.log(`[Stream Video Saver] Retrying ${failedSegments.length} failed segment(s)...`);

    // Retry failed segments in smaller batches
    for (let i = 0; i < failedSegments.length; i += RETRY_BATCH_SIZE) {
      // Check if cancelled
      if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
        throw new Error('Download cancelled');
      }

      const batch = failedSegments.slice(i, i + RETRY_BATCH_SIZE);

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
          const blobSize = blob.size;
          downloadedBytes += blobSize;

          // Extract filename
          let fileName: string;
          try {
            if (url.startsWith('http://') || url.startsWith('https://')) {
              const urlObj = new URL(url);
              const pathParts = urlObj.pathname.split('/');
              fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'segment.ts';
            } else {
              const urlParts = url.split('?')[0].split('/');
              fileName = urlParts[urlParts.length - 1] || 'segment.ts';
            }
            fileName = fileName.split('?')[0];
          } catch (error) {
            fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0] || 'segment.ts';
          }

          if (!fileName) {
            throw new Error('Could not extract filename from URL');
          }

          // Convert blob to ArrayBuffer for better memory efficiency with large files
          const arrayBuffer = await blob.arrayBuffer();
          zip.file(fileName, arrayBuffer, { binary: true });
          downloaded++;

          // Calculate download speed
          const now = Date.now();
          const timeDelta = (now - lastUpdateTime) / 1000; // seconds
          let downloadSpeed = 0;
          if (timeDelta > 0) {
            const bytesDelta = downloadedBytes - lastDownloadedBytes;
            downloadSpeed = bytesDelta / timeDelta; // bytes per second
            lastUpdateTime = now;
            lastDownloadedBytes = downloadedBytes;
          }

          // Update progress
          const download = activeDownloads.get(downloadId);
          if (download) {
            download.progress = {
              downloaded,
              total,
              status: 'downloading',
              downloadedBytes,
              totalBytes,
              downloadSpeed
            };
          }
          notifyDownloadProgress(downloadId, {
            downloaded,
            total,
            status: 'downloading',
            downloadedBytes,
            totalBytes,
            downloadSpeed
          });

          console.log(`[Stream Video Saver] Successfully retried segment: ${fileName}`);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Stream Video Saver] Failed to retry segment ${url}:`, errorMessage);
          // Don't throw on retry failure - we'll continue with partial download
          // Log a warning instead
          console.warn(`[Stream Video Saver] Segment ${url} failed even after retry. Download may be incomplete.`);
        }
      }));
    }
  }

  // Check if cancelled before creating zip
  if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
    throw new Error('Download cancelled');
  }

  // Calculate total bytes downloaded (approximation based on downloaded blobs)
  totalBytes = downloadedBytes;

  // Generate zip file - notify user that ZIP creation is starting
  notifyDownloadProgress(downloadId, {
    downloaded,
    total,
    status: 'creating_zip',
    downloadedBytes,
    totalBytes,
    downloadSpeed: 0
  });

  // Generate ZIP as ArrayBuffer (service workers don't support Blob/URL.createObjectURL)
  // This can take a while for large files
  const zipArrayBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const zipSize = zipArrayBuffer.byteLength;

  // Update progress with ZIP size
  notifyDownloadProgress(downloadId, {
    downloaded,
    total,
    status: 'creating_zip',
    downloadedBytes,
    totalBytes,
    downloadSpeed: 0,
    zipSize
  });

  // Check if cancelled after ZIP generation
  if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
    throw new Error('Download cancelled');
  }

  // Keep status as 'creating_zip' during base64 conversion as well
  // This is still part of preparing the file for download
  // Convert ArrayBuffer to base64 data URL for chrome.downloads API
  // Use chunked conversion to avoid stack overflow with large files
  const bytes = new Uint8Array(zipArrayBuffer);
  let binary = '';
  const chunkSize = 8192; // Process in 8KB chunks
  const totalChunks = Math.ceil(bytes.length / chunkSize);
  let processedChunks = 0;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    // Check for cancellation periodically during conversion
    if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
      throw new Error('Download cancelled');
    }

    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
    processedChunks++;

    // Update progress periodically during base64 conversion (every 10% or every 100 chunks)
    // Keep the zipSize and totalBytes in the progress during conversion
    if (processedChunks % Math.max(1, Math.floor(totalChunks / 10)) === 0 || processedChunks === totalChunks) {
      notifyDownloadProgress(downloadId, {
        downloaded,
        total,
        status: 'creating_zip',
        downloadedBytes,
        totalBytes,
        downloadSpeed: 0,
        zipSize
      });
    }
  }
  const base64 = btoa(binary);
  const dataUrl = `data:application/zip;base64,${base64}`;

  // Create download using chrome.downloads API
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Use title if available, otherwise fall back to m3u8 filename
  const zipBaseName = manifest.title
    ? sanitizeFilename(manifest.title)
    : (manifest.m3u8FileName.replace('.m3u8', '') || 'video');
  const zipFileName = `${zipBaseName}-${timestamp}.zip`;

  chrome.downloads.download({
    url: dataUrl,
    filename: zipFileName,
    saveAs: true
  }, (_chromeDownloadId?: number) => {
    if (chrome.runtime.lastError) {
      const errorMessage = chrome.runtime.lastError.message || 'Unknown error';
      notifyDownloadError(downloadId, errorMessage);
      activeDownloads.delete(downloadId);
    } else {
      notifyDownloadProgress(downloadId, {
        downloaded,
        total,
        status: 'complete',
        downloadedBytes,
        totalBytes,
        downloadSpeed: 0,
        zipSize
      });
      // Clean up after a short delay
      setTimeout(() => {
        activeDownloads.delete(downloadId);
        // Clear badge if no active downloads remain
        if (activeDownloads.size === 0) {
          chrome.action.setBadgeText({ text: '' });
        }
      }, 2000);
    }
  });
}

/**
 * Modifies m3u8 content to use local filenames instead of full URLs.
 * Extracts just the filename from each segment URL line while preserving comments and metadata.
 * Also updates #EXT-X-MAP URI attributes to use local filenames.
 * @param content - The original m3u8 file content
 * @param baseUrl - The base URL of the m3u8 file (used for parsing relative URLs)
 * @returns Modified m3u8 content with local filenames
 */
function modifyM3U8ForLocalFiles(content: string, _baseUrl: string): string {
  const lines = content.split('\n');
  const modifiedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Handle #EXT-X-MAP tags - update URI to use local filename
    if (trimmedLine.startsWith('#EXT-X-MAP:')) {
      const uriMatch = trimmedLine.match(/URI="([^"]+)"/);
      if (uriMatch && uriMatch[1]) {
        const uri = uriMatch[1];
        let filename: string;

        try {
          // Extract filename from URI
          if (uri.startsWith('http://') || uri.startsWith('https://')) {
            const url = new URL(uri);
            const pathParts = url.pathname.split('/');
            filename = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'init.mp4';
          } else if (uri.startsWith('/')) {
            const pathParts = uri.split('/');
            filename = pathParts[pathParts.length - 1] || 'init.mp4';
          } else {
            const urlParts = uri.split('?')[0].split('/');
            filename = urlParts[urlParts.length - 1] || 'init.mp4';
          }

          if (filename) {
            filename = filename.split('?')[0];
            // Replace the URI in the tag with just the filename
            const modifiedLine = trimmedLine.replace(/URI="[^"]+"/, `URI="${filename}"`);
            modifiedLines.push(modifiedLine);
            console.log(`[Stream Video Saver] Updated #EXT-X-MAP URI: ${uri} -> ${filename}`);
            continue;
          }
        } catch (error) {
          console.warn(`[Stream Video Saver] Failed to parse init segment URI: ${uri}`, error);
        }
      }
      // If we couldn't parse it, keep the original line
      modifiedLines.push(line);
      continue;
    }

    // Keep other comments and empty lines as-is
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      modifiedLines.push(line);
      continue;
    }

    // This is a segment URL line - extract just the filename
    try {
      let filename: string;

      // If it's a full URL, parse it
      if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
        const url = new URL(trimmedLine);
        const pathParts = url.pathname.split('/');
        filename = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'segment.ts';
      } else if (trimmedLine.startsWith('/')) {
        const pathParts = trimmedLine.split('/');
        filename = pathParts[pathParts.length - 1] || 'segment.ts';
      } else {
        const urlParts = trimmedLine.split('?')[0].split('/');
        filename = urlParts[urlParts.length - 1] || 'segment.ts';
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
 * Updates the extension badge to show download progress.
 * @param progress - Progress information object
 */
function updateBadge(progress: DownloadProgress): void {
  if (progress.status === 'complete' || progress.status === 'cancelled') {
    // Clear badge when download is complete or cancelled
    chrome.action.setBadgeText({ text: '' });
  } else {
    // Show percentage on badge
    const percent = Math.round((progress.downloaded / progress.total) * 100);
    chrome.action.setBadgeText({ text: `${percent}%` });
    chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
  }
}

/**
 * Sends download progress update to the popup and updates the extension badge.
 * @param downloadId - The ID of the download
 * @param progress - Progress information object
 */
function notifyDownloadProgress(downloadId: string, progress: DownloadProgress): void {
  // Update extension badge
  updateBadge(progress);

  // Send message to popup
  chrome.runtime.sendMessage({
    action: 'downloadProgress',
    downloadId,
    ...progress
  } as ExtensionMessage).catch(() => {
    // Ignore if no listeners
  });
}

/**
 * Sends download error notification to the popup and clears the badge.
 * @param downloadId - The ID of the download that failed
 * @param error - Error message describing what went wrong
 */
function notifyDownloadError(downloadId: string, error: string): void {
  // Clear badge on error
  chrome.action.setBadgeText({ text: '' });

  // Send message to popup
  chrome.runtime.sendMessage({
    action: 'downloadError',
    downloadId,
    error
  } as ExtensionMessage).catch(() => {
    // Ignore if no listeners
  });
}

