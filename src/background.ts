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
  CancelDownloadMessage,
  PreviewFrameReadyMessage,
  AddToIgnoreListMessage,
  RemoveFromIgnoreListMessage,
  IgnoreListResponse,
  GetCurrentTabResponse,
} from './types/index.js';
import { logger } from './utils/logger.js';

/**
 * Regular expression pattern to match m3u8 files in URLs.
 * Matches any .m3u8 file including master.m3u8, index-f*-v*-a*.m3u8, etc.
 */
const M3U8_PATTERN = /\.m3u8(\?|$)/i;

const BATCH_SIZE = 10;

const RETRY_BATCH_SIZE = 5;

/**
 * Maximum number of manifests to keep in history.
 * Prevents unbounded memory growth.
 */
const MAX_MANIFEST_HISTORY = 100;

/**
 * Array of captured manifest objects.
 */
let manifestHistory: Manifest[] = [];

/**
 * Map tracking active downloads.
 */
let activeDownloads = new Map<string, ActiveDownload>();

/**
 * Storage key for ignored domains list.
 */
const IGNORE_LIST_STORAGE_KEY = 'ignoredDomains';

/**
 * Generates a unique ID for each manifest using timestamp and random string.
 * @returns A unique identifier combining timestamp and random characters
 */
function generateManifestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

logger.log('Background script loaded');
logger.log('Starting continuous monitoring for m3u8 files...');

/**
 * Map to store request headers by requestId for m3u8 requests.
 * Headers are captured in onBeforeSendHeaders and used in onCompleted.
 */
const requestHeadersMap = new Map<string, chrome.webRequest.HttpHeader[]>();

// Capture request headers for m3u8 files BEFORE they're sent
// This is necessary because requestHeaders are not available in onCompleted
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details: chrome.webRequest.WebRequestHeadersDetails) => {
    if (M3U8_PATTERN.test(details.url)) {
      //logger.groupCollapsed(` Capturing headers for m3u8: ${details.url}`);
      //logger.log(`Request ID: ${details.requestId}`);
      if (details.requestHeaders) {
        //logger.log(`Headers (${details.requestHeaders.length}):`);
        for (const header of details.requestHeaders) {
          //logger.log(`  ${header.name}: ${header.value || '(empty)'}`);
        }
        requestHeadersMap.set(details.requestId, details.requestHeaders);
        // Clean up after 5 minutes to prevent memory leaks
        setTimeout(() => {
          requestHeadersMap.delete(details.requestId);
        }, 300000);
      } else {
        logger.warn(`No requestHeaders available for m3u8 request`);
      }
      logger.groupEnd();
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

// Monitor completed requests and process m3u8 files
chrome.webRequest.onCompleted.addListener(
  (details: chrome.webRequest.WebResponseDetails) => {
    // Silently process m3u8 requests (only log when a new manifest is found)
    handleRequestCompleted(details as unknown as chrome.webRequest.WebRequestBodyDetails);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

//logger.log('[Stream Video Saver] ✅ Continuous monitoring active');
//logger.log(` M3U8_PATTERN: ${M3U8_PATTERN}`);

/**
 * Handles the 'getStatus' action by filtering and deduplicating manifests.
 * @param sendResponse - Function to send the response back
 */
async function handleGetStatus(sendResponse: (response: ExtensionResponse) => void): Promise<void> {
  // Get ignored domains
  const ignoredDomains = await new Promise<string[]>((resolve) => {
    chrome.storage.local.get(IGNORE_LIST_STORAGE_KEY, (result) => {
      resolve(result[IGNORE_LIST_STORAGE_KEY] || []);
    });
  });

  // Filter out manifests with no segments, ignored page domains, and remove duplicates
  // Group by URL (without query params) OR (title + segment count) and keep only the most recent one
  const manifestsWithSegments = manifestHistory
    .filter((m) => {
      // Only include manifests with segments
      if (m.expectedSegments.length === 0) {
        return false;
      }
      // Filter out manifests from pages with ignored domains (check pageDomain, not m3u8Url domain)
      if (m.pageDomain && ignoredDomains.includes(m.pageDomain)) {
        return false;
      }
      return true;
    })
    .map((m) => ({
      id: m.id,
      fileName: m.m3u8FileName,
      title: m.title,
      url: m.m3u8Url,
      segmentCount: m.expectedSegments.length,
      capturedAt: m.capturedAt,
      resolution: m.resolution,
      duration: m.duration,
      previewUrls: m.previewUrls,
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
      duration: m.duration,
      previewUrls: m.previewUrls
    }))
    // Sort by capturedAt in descending order (most recent first)
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());

  //logger.log(` getStatus: returning ${filtered.length} manifests (filtered from ${manifestHistory.length} total, removed ${manifestHistory.length - filtered.length} with no segments or duplicates)`);
  //logger.log(` Manifest IDs: ${filtered.map((m) => m.id).join(', ')}`);
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
    logger.log(`✅ Manifest cleared: ${message.manifestId}. Remaining: ${manifestHistory.length}`);
  } else {
    manifestHistory = [];
    logger.log('✅ All manifests cleared');
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
  logger.log(`📥 Segment downloaded: ${segmentUrl}`);

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
    logger.error('Error starting download:', error);
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
 * Extracts domain from a URL.
 * @param url - The URL to extract domain from
 * @returns The domain or undefined if URL is invalid
 */
function extractDomain(url: string): string | undefined {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return undefined;
  }
}

/**
 * Checks if a domain is in the ignore list.
 * @param domain - The domain to check
 * @returns True if domain is ignored, false otherwise
 */
async function isDomainIgnored(domain: string): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(IGNORE_LIST_STORAGE_KEY);
    const ignoredDomains: string[] = result[IGNORE_LIST_STORAGE_KEY] || [];
    return ignoredDomains.includes(domain);
  } catch (error) {
    logger.error('Error checking ignore list:', error);
    return false;
  }
}

/**
 * Handles the 'getIgnoreList' action by returning the list of ignored domains.
 * @param sendResponse - Function to send the response back
 */
function handleGetIgnoreList(sendResponse: (response: ExtensionResponse) => void): void {
  chrome.storage.local.get(IGNORE_LIST_STORAGE_KEY, (result) => {
    const ignoredDomains: string[] = result[IGNORE_LIST_STORAGE_KEY] || [];
    const response: IgnoreListResponse = { domains: ignoredDomains };
    sendResponse(response);
  });
}

/**
 * Handles the 'addToIgnoreList' action by adding a domain to the ignore list.
 * Also removes all existing manifests from pages with that domain.
 * @param message - The message containing the domain to add
 * @param sendResponse - Function to send the response back
 */
function handleAddToIgnoreList(message: AddToIgnoreListMessage, sendResponse: (response: ExtensionResponse) => void): void {
  chrome.storage.local.get(IGNORE_LIST_STORAGE_KEY, (result) => {
    const ignoredDomains: string[] = result[IGNORE_LIST_STORAGE_KEY] || [];
    
    if (ignoredDomains.includes(message.domain)) {
      sendResponse({ error: 'Domain already in ignore list' });
      return;
    }

    ignoredDomains.push(message.domain);
    chrome.storage.local.set({ [IGNORE_LIST_STORAGE_KEY]: ignoredDomains }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message || 'Failed to save ignore list' });
      } else {
        // Remove all existing manifests from pages with this domain (check pageDomain, not m3u8Url domain)
        const initialCount = manifestHistory.length;
        manifestHistory = manifestHistory.filter((m) => {
          // Filter out manifests where the page domain matches the ignored domain
          return m.pageDomain !== message.domain;
        });
        const removedCount = initialCount - manifestHistory.length;
        
        if (removedCount > 0) {
          logger.log(` Removed ${removedCount} manifest(s) from ignored domain: ${message.domain}`);
        }

        // Notify popup that manifests were updated (this will trigger a refresh)
        chrome.runtime.sendMessage({
          action: 'manifestCaptured',
          manifestId: '',
          fileName: '',
          title: '',
          segmentCount: 0
        } as ExtensionMessage).catch(() => {
          // Ignore if no listeners
        });

        sendResponse({ success: true });
      }
    });
  });
}

/**
 * Handles the 'removeFromIgnoreList' action by removing a domain from the ignore list.
 * @param message - The message containing the domain to remove
 * @param sendResponse - Function to send the response back
 */
function handleRemoveFromIgnoreList(message: RemoveFromIgnoreListMessage, sendResponse: (response: ExtensionResponse) => void): void {
  chrome.storage.local.get(IGNORE_LIST_STORAGE_KEY, (result) => {
    const ignoredDomains: string[] = result[IGNORE_LIST_STORAGE_KEY] || [];
    const filtered = ignoredDomains.filter(d => d !== message.domain);
    
    if (filtered.length === ignoredDomains.length) {
      sendResponse({ error: 'Domain not found in ignore list' });
      return;
    }

    chrome.storage.local.set({ [IGNORE_LIST_STORAGE_KEY]: filtered }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message || 'Failed to save ignore list' });
      } else {
        sendResponse({ success: true });
      }
    });
  });
}

/**
 * Handles the 'getCurrentTab' action by returning information about the current active tab.
 * @param sendResponse - Function to send the response back
 */
function handleGetCurrentTab(sendResponse: (response: ExtensionResponse) => void): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0 || !tabs[0].url) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    const tab = tabs[0];
    const url = tab.url;
    const domain = url ? extractDomain(url) : undefined;
    const response: GetCurrentTabResponse = {
      url: url,
      domain: domain,
      title: tab.title
    };
    sendResponse(response);
  });
}

/**
 * Processes m3u8 content fetched by the background script.
 * @param url - The m3u8 URL
 * @param text - The m3u8 content
 * @param details - The request details (for tabId, etc.)
 */
async function processM3U8Content(
  url: string,
  text: string,
  details: chrome.webRequest.WebRequestBodyDetails & { tabId?: number }
): Promise<void> {
  // Extract filename for display
  let fileName: string;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    fileName = pathParts[pathParts.length - 1] || 'manifest.m3u8';
  } catch (error) {
    // Fallback for invalid URLs
    const urlWithoutQuery = url.split('?')[0];
    const pathParts = urlWithoutQuery.split('/').filter(part => part.length > 0);
    fileName = pathParts[pathParts.length - 1] || 'manifest.m3u8';
  }

  logger.groupCollapsed(` Processing M3U8: ${fileName}`);
  logger.log(`Content length: ${text.length} chars`);
  logger.log(`Content preview (first 500 chars): ${text.substring(0, 500)}`);

  // Only process VOD (Video On Demand) playlists - skip master playlists and live streams
  if (!text.includes('#EXT-X-PLAYLIST-TYPE:VOD')) {
    logger.log(`Skipping non-VOD manifest (missing #EXT-X-PLAYLIST-TYPE:VOD)`);
    logger.groupEnd();
    return;
  }

  // Parse and store expected segment URLs immediately
  const segmentUrls = parseM3U8(text, url);

  // Only add to history if it has segments (additional safety check)
  if (segmentUrls.length === 0) {
    logger.log(`Skipping manifest with no segments`);
    logger.groupEnd();
    return;
  }

  // Parse resolution and duration from manifest
  const resolution = parseResolution(text);
  const duration = parseDuration(text);

  if (resolution) {
    logger.log(`Resolution: ${resolution.width}x${resolution.height}`);
  }
  if (duration) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    logger.log(`Duration: ${minutes}m ${seconds}s (${duration.toFixed(1)}s total)`);
  }

  // Try to get video title from the page (needed for duplicate detection)
  let title: string | undefined;

  // First, try to get video title from content script (preview will be captured asynchronously)
  if (details.tabId && details.tabId > 0) {
    logger.log(`Requesting video title from tab ${details.tabId}`);
    try {
      const videoTitleResponse = await chrome.tabs.sendMessage(details.tabId, { action: 'getVideoTitle' });

      if (videoTitleResponse && videoTitleResponse.title) {
        title = videoTitleResponse.title;
        logger.log(`Found video title from content script: ${title}`);
      } else {
        logger.log('No video title in response');
      }
    } catch (error) {
      // Content script might not be available, continue to fallback
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log(`Could not get video title from content script (${errorMessage}), trying tab title`);
    }
  } else {
    logger.log('No tabId available, skipping title extraction');
  }

  // Fallback to tab title if video title not found
  if (!title && details.tabId && details.tabId > 0) {
    try {
      const tab = await chrome.tabs.get(details.tabId);
      if (tab && tab.title) {
        title = tab.title;
        logger.log(`Using tab title: ${title}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log(`Could not get tab title: ${errorMessage}`);
    }
  }

  // Check for duplicates: same URL OR (same title AND same segment count)
  // This check happens after title is fetched so we can properly detect title+segment duplicates
  const urlWithoutQuery = url.split('?')[0];
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
    logger.log(`Duplicate detected, updating existing manifest: ${duplicateCheck.id}`);
    duplicateCheck.m3u8Url = url; // Update URL in case query params changed
    duplicateCheck.m3u8Content = text; // Update content
    duplicateCheck.m3u8FileName = fileName; // Update filename
    duplicateCheck.title = title || duplicateCheck.title; // Update title if we have a better one
    duplicateCheck.expectedSegments = segmentUrls; // Update segments
    duplicateCheck.capturedAt = new Date().toISOString(); // Update timestamp
    duplicateCheck.resolution = resolution || duplicateCheck.resolution; // Update resolution if available
    duplicateCheck.duration = duration || duplicateCheck.duration; // Update duration if available
    // Preview URLs will be updated asynchronously via capturePreviewAsync

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

    logger.groupEnd();
    return;
  }

  // Get page domain for ignore list filtering
  let pageDomain: string | undefined;
  if (details.tabId && details.tabId > 0) {
    try {
      const tab = await chrome.tabs.get(details.tabId);
      if (tab && tab.url) {
        pageDomain = extractDomain(tab.url);
      }
    } catch (error) {
      // Tab might not be available, skip storing page domain
    }
  }

  // Create manifest object and add to history (without previewUrls initially)
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
    duration: duration,
    tabId: details.tabId && details.tabId > 0 ? details.tabId : undefined,
    pageDomain: pageDomain,
    previewUrls: undefined // Will be updated when preview is ready
  };

  manifestHistory.push(manifest);

  // Prevent unbounded memory growth by limiting manifest history
  if (manifestHistory.length > MAX_MANIFEST_HISTORY) {
    // Remove oldest manifests (keep most recent)
    const excess = manifestHistory.length - MAX_MANIFEST_HISTORY;
    manifestHistory.splice(0, excess);
    logger.log(`Trimmed manifest history: removed ${excess} oldest manifests (keeping ${MAX_MANIFEST_HISTORY} most recent)`);
  }

  logger.log(`✅ M3U8 captured and added to history`);
  logger.log(`📋 Found ${segmentUrls.length} segments`);
  logger.log(`📚 Total manifests in history: ${manifestHistory.length}`);

  if (segmentUrls.length > 0) {
    logger.log(`First few segments: ${segmentUrls.slice(0, 3)}`);
  }

  // Notify popup that a new manifest is available (immediately, before preview is ready)
  chrome.runtime.sendMessage({
    action: 'manifestCaptured',
    manifestId: manifestId,
    fileName: fileName,
    title: title,
    segmentCount: segmentUrls.length
  } as ExtensionMessage).catch(() => {
    // Ignore if no listeners
  });

  // Capture preview asynchronously (don't block manifest creation)
  if (details.tabId && details.tabId > 0) {
    capturePreviewAsync(details.tabId, manifestId).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log(`Error capturing preview asynchronously: ${errorMessage}`);
    });
  }
  logger.groupEnd();
}

/**
 * Captures video preview frames asynchronously and updates the manifest when ready.
 * @param tabId - Tab ID where the video is playing
 * @param manifestId - ID of the manifest to update with preview frames
 */
/**
 * Captures video preview frames asynchronously.
 * Frames are sent individually as they're captured via previewFrameReady messages.
 * @param tabId - Tab ID where the video is playing
 * @param manifestId - ID of the manifest to update with preview frames
 */
async function capturePreviewAsync(tabId: number, manifestId: string): Promise<void> {
  logger.groupCollapsed(` Starting async preview capture: manifest ${manifestId}`);
  logger.log(`Tab ID: ${tabId}`);

  // Initialize previewUrls array in manifest
  const manifest = manifestHistory.find((m) => m.id === manifestId);
  if (!manifest) {
    logger.log(`Manifest not found when starting preview capture`);
    logger.groupEnd();
    return;
  }

  if (!manifest.previewUrls) {
    manifest.previewUrls = [];
  }

  try {
    // Send message to content script with manifestId
    // Content script will send individual frames as previewFrameReady messages
    await chrome.tabs.sendMessage(tabId, { action: 'getVideoPreview', manifestId: manifestId });
    logger.log(`Preview capture initiated - individual frames will arrive via previewFrameReady messages`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log(`Error initiating preview capture: ${errorMessage}`);
  }
  logger.groupEnd();
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
  //logger.log(` Background received message: ${message.action}`);

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

    case 'previewFrameReady':
      // Handle individual preview frame as it arrives
      handlePreviewFrameReady(message as PreviewFrameReadyMessage);
      return false; // No response needed

    case 'getIgnoreList':
      handleGetIgnoreList(sendResponse);
      return true;

    case 'addToIgnoreList':
      handleAddToIgnoreList(message as AddToIgnoreListMessage, sendResponse);
      return true;

    case 'removeFromIgnoreList':
      handleRemoveFromIgnoreList(message as RemoveFromIgnoreListMessage, sendResponse);
      return true;

    case 'getCurrentTab':
      handleGetCurrentTab(sendResponse);
      return true;

    default:
      logger.warn(` Unknown message action: ${(message as { action: unknown }).action}`);
      return false;
  }
});

/**
 * Handles individual preview frame ready messages from content script.
 * Updates manifest and notifies popup incrementally.
 * @param message - PreviewFrameReadyMessage containing frame data
 */
function handlePreviewFrameReady(message: PreviewFrameReadyMessage): void {
  const { manifestId, frameUrl, frameIndex } = message;

  const manifest = manifestHistory.find((m) => m.id === manifestId);
  if (!manifest) {
    logger.log(` Manifest ${manifestId} not found when handling preview frame ${frameIndex}`);
    return;
  }

  // Initialize previewUrls array if needed
  if (!manifest.previewUrls) {
    manifest.previewUrls = [];
  }

  // Insert frame at correct index (may have gaps if frames arrive out of order)
  manifest.previewUrls[frameIndex] = frameUrl;

  // Get all frames collected so far (remove any undefined gaps)
  const collectedFrames = manifest.previewUrls.filter((url): url is string => url !== undefined);

  // Send incremental update to popup with all frames collected so far
  chrome.runtime.sendMessage({
    action: 'previewUpdated',
    manifestId: manifestId,
    previewUrls: collectedFrames
  } as ExtensionMessage).catch(() => {
    // Ignore if no listeners
  });

  logger.log(` Preview frame ${frameIndex} received for manifest ${manifestId} (total: ${collectedFrames.length})`);
}

/**
 * Sanitizes a filename by removing non-ASCII characters and invalid filesystem characters.
 * Keeps only ASCII alphanumeric, dots, hyphens, and underscores.
 * @param filename - The filename to sanitize
 * @returns Sanitized filename with only ASCII characters
 */
function sanitizeSegmentFilename(filename: string): string {
  // Remove non-ASCII characters (keep only ASCII: 0x00-0x7F)
  // Also remove invalid filesystem characters: < > : " / \ | ? * and control characters
  return filename
    .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII characters
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid filesystem characters
    .replace(/\s+/g, '_') // Replace whitespace with underscore
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single underscore
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
}

/**
 * Extracts just the filename from a URL (without folder path).
 * Uses URL constructor for consistent parsing.
 * Sanitizes the filename to remove non-ASCII characters.
 * @param url - The URL to extract filename from
 * @param defaultName - Default filename if extraction fails (e.g., 'segment.ts' or 'init.mp4')
 * @returns Just the filename, sanitized to ASCII only (e.g., 'segment.ts', 'init.mp4')
 */
function extractBaseFilename(url: string, defaultName: string = 'segment.ts'): string {
  let filename: string;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    filename = pathParts[pathParts.length - 1] || defaultName;
  } catch (error) {
    // If URL constructor fails (e.g., relative URL without base), fall back to manual parsing
    const urlWithoutQuery = url.split('?')[0];
    const parts = urlWithoutQuery.split('/').filter(part => part.length > 0);
    filename = parts[parts.length - 1] || defaultName;
  }
  // Remove query parameters if any
  filename = filename.split('?')[0];
  // Sanitize to remove non-ASCII characters
  const sanitized = sanitizeSegmentFilename(filename);
  // If sanitization removed everything, use default
  return sanitized || defaultName;
}

/**
 * Extracts folder name and filename from a URL.
 * Sanitizes both to remove non-ASCII characters.
 * @param url - The URL to extract from
 * @returns Object with folderName (may be empty) and segmentName, both sanitized to ASCII only
 */
function extractFolderAndFilename(url: string): { folderName: string; segmentName: string; defaultName?: string } {
  const defaultName = 'segment.ts';
  let segmentName: string;
  let folderName: string;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    segmentName = pathParts[pathParts.length - 1] || defaultName;
    folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
  } catch (error) {
    // Fallback for invalid URLs
    const urlWithoutQuery = url.split('?')[0];
    const parts = urlWithoutQuery.split('/').filter(part => part.length > 0);
    segmentName = parts[parts.length - 1] || defaultName;
    folderName = parts.length > 1 ? parts[parts.length - 2] : '';
  }
  // Remove query parameters if any
  segmentName = segmentName.split('?')[0];
  folderName = folderName.split('?')[0];
  // Sanitize both to remove non-ASCII characters
  return {
    folderName: sanitizeSegmentFilename(folderName),
    segmentName: sanitizeSegmentFilename(segmentName) || defaultName
  };
}

/**
 * Creates a mapping from segment URLs to unique filenames.
 * Only applies unique naming when filenames are duplicated (same filename, different paths).
 * @param segmentUrls - Array of segment URLs
 * @param defaultName - Default filename if extraction fails
 * @returns Map from URL to unique filename
 */
function createUrlToFilenameMap(segmentUrls: string[], defaultName: string = 'segment.ts'): Map<string, string> {
  const urlToFilename = new Map<string, string>();
  const filenameCounts = new Map<string, number>();
  const filenameToUrls = new Map<string, string[]>();

  // First pass: extract base filenames and count occurrences
  for (const url of segmentUrls) {
    const baseFilename = extractBaseFilename(url, defaultName);
    urlToFilename.set(url, baseFilename);

    if (!filenameCounts.has(baseFilename)) {
      filenameCounts.set(baseFilename, 0);
      filenameToUrls.set(baseFilename, []);
    }
    filenameCounts.set(baseFilename, filenameCounts.get(baseFilename)! + 1);
    filenameToUrls.get(baseFilename)!.push(url);
  }

  // Second pass: only for duplicates, create unique filenames using folder name
  for (const [filename, urls] of filenameToUrls.entries()) {
    if (urls.length > 1) {
      // This filename appears multiple times - need unique naming
      for (const url of urls) {
        const { folderName, segmentName } = extractFolderAndFilename(url);
        const uniqueFilename = folderName ? `${folderName}__${segmentName}` : segmentName;
        urlToFilename.set(url, uniqueFilename);
        logger.log(` Duplicate filename detected: ${filename} -> ${uniqueFilename}`);
      }
    }
    // If filename is unique, keep it as-is (already set in first pass)
  }

  return urlToFilename;
}

/**
 * Parses an m3u8 playlist file and extracts segment URLs.
 * Handles absolute URLs, relative URLs, and URLs with query parameters.
 * @param content - The m3u8 file content as a string
 * @param baseUrl - The base URL of the m3u8 file (used for resolving relative URLs)
 * @returns Array of absolute segment URLs
 */
function parseM3U8(content: string, baseUrl: string): string[] {
  logger.log(` Parsing m3u8, baseUrl: ${baseUrl}`);
  const lines = content.split('\n');
  const segmentUrls: string[] = [];

  if (!baseUrl) {
    logger.warn('[Stream Video Saver] No baseUrl provided for parsing');
    return segmentUrls;
  }

  // Parse base URL - handle query parameters
  const baseUrlWithoutQuery = baseUrl.split('?')[0];
  const base = new URL(baseUrlWithoutQuery);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
  logger.log(` Base origin: ${base.origin}`);
  logger.log(` Base path: ${basePath}`);

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
        logger.log(` Found segment/manifest: ${line} -> ${segmentUrl}`);
      }
      segmentUrls.push(segmentUrl);
    }
  }

  logger.log(` Total segments/manifests parsed: ${segmentUrls.length}`);
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
  logger.log(` Parsing m3u8 for init segments, baseUrl: ${baseUrl}`);
  const lines = content.split('\n');
  const initSegmentUrls: string[] = [];

  if (!baseUrl) {
    logger.warn('[Stream Video Saver] No baseUrl provided for parsing init segments');
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

        logger.log(` Found init segment: ${uri} -> ${initSegmentUrl}`);
        initSegmentUrls.push(initSegmentUrl);
      }
    }
  }

  logger.log(` Total init segments parsed: ${initSegmentUrls.length}`);
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
async function handleRequestCompleted(details: chrome.webRequest.WebRequestBodyDetails & { requestHeaders?: chrome.webRequest.HttpHeader[] }): Promise<void> {
  const url = details.url;

  // Check if it's an m3u8 file
  if (!M3U8_PATTERN.test(url)) {
    return;
  }

  // Check if the page domain (where the user is viewing) is in the ignore list
  let pageDomain: string | undefined;
  if (details.tabId && details.tabId > 0) {
    try {
      const tab = await chrome.tabs.get(details.tabId);
      if (tab && tab.url) {
        pageDomain = extractDomain(tab.url);
        if (pageDomain && await isDomainIgnored(pageDomain)) {
          logger.log(` Skipping ${url} - page domain ${pageDomain} is in ignore list`);
          return; // Silently skip - page domain is ignored
        }
      }
    } catch (error) {
      // Tab might not be available, continue processing
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log(` Could not get tab for domain check (${errorMessage}), continuing`);
    }
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
    // Already have it, skip processing silently
    return;
  }

  // Mark as being processed
  recentlyProcessed.add(urlWithoutQuery);

  // Remove from cooldown set after cooldown period
  setTimeout(() => {
    recentlyProcessed.delete(urlWithoutQuery);
  }, PROCESSING_COOLDOWN);

  try {

    // Fetch the m3u8 using proper Fetch API options instead of manually copying headers
    // Headers are captured in onBeforeSendHeaders and stored by requestId
    const headers: Record<string, string> = {};

    // Look up the captured headers for this request
    const capturedHeaders = requestHeadersMap.get(details.requestId);
    let fetchMode: RequestMode = 'cors'; // Default to CORS for cross-origin requests

    if (capturedHeaders) {
      logger.log(` Found ${capturedHeaders.length} captured headers for requestId: ${details.requestId}`);

      // Determine fetch mode from Sec-Fetch-Mode header (if present)
      const secFetchMode = capturedHeaders.find(h => h.name.toLowerCase() === 'sec-fetch-mode');
      if (secFetchMode?.value) {
        const mode = secFetchMode.value.toLowerCase();
        if (mode === 'cors' || mode === 'no-cors' || mode === 'same-origin' || mode === 'navigate') {
          fetchMode = mode as RequestMode;
          logger.log(` Using fetch mode from Sec-Fetch-Mode: ${fetchMode}`);
        }
      }

      // Only copy headers that can be manually set (exclude sec-* headers)
      for (const header of capturedHeaders) {
        const name = header.name.toLowerCase();
        // Include headers that can be manually set (exclude sec-* headers)
        if (
          name === 'user-agent' ||
          name === 'accept' ||
          name === 'accept-language' ||
          name === 'accept-encoding' ||
          (name.startsWith('x-') && !name.startsWith('sec-')) ||
          name === 'authorization'
        ) {
          headers[header.name] = header.value || '';
          logger.log(` Copying header: ${header.name} = ${header.value?.substring(0, 50)}...`);
        }
      }
      // Clean up the captured headers
      requestHeadersMap.delete(details.requestId);
    } else {
      logger.log(` No captured headers found for requestId: ${details.requestId}`);
    }

    logger.log(` Fetching m3u8 content from: ${url}`);

    // Build fetch options using proper Fetch API methods
    const fetchOptions: RequestInit = {
      mode: fetchMode, // Use CORS mode (or detected mode) - this handles sec-* headers automatically
      credentials: 'include',  // Important: include cookies for authentication
      referrerPolicy: 'origin', // Set referrer policy
      cache: 'no-cache' // Don't use cached responses
    };

    // Add manually settable headers
    if (Object.keys(headers).length > 0) {
      fetchOptions.headers = headers;
      logger.log(` Using ${Object.keys(headers).length} manually settable headers from original request`);
    }

    logger.log(` Fetch options: mode=${fetchOptions.mode}, credentials=${fetchOptions.credentials}, referrerPolicy=${fetchOptions.referrerPolicy}, headers=${Object.keys(headers).length} headers`);
    // Fetch the m3u8 content with the same headers as the original request
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorMsg = `Failed to fetch m3u8 file: ${response.status} ${response.statusText}`;
      logger.error(` ${errorMsg}`);

      // Show error to user - send error message to popup if it's open
      chrome.runtime.sendMessage({
        action: 'm3u8FetchError',
        url: url,
        status: response.status,
        statusText: response.statusText,
        error: errorMsg
      } as ExtensionMessage).catch(() => {
        // Ignore if no listeners (popup might not be open)
      });

      // Don't try anything else - just return
      return;
    }

    const text = await response.text();

    // Process the fetched content
    await processM3U8Content(url, text, details);

    // Only log when a new manifest is successfully added
    logger.log(` ✓ New manifest captured: ${url}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorMsg = `Error fetching m3u8 file: ${errorMessage}`;
    logger.error(` ${errorMsg}`, error);

    // Show error to user - send error message to popup if it's open
    chrome.runtime.sendMessage({
      action: 'm3u8FetchError',
      url: url,
      status: 0,
      statusText: 'Network Error',
      error: errorMsg
    } as ExtensionMessage).catch(() => {
      // Ignore if no listeners (popup might not be open)
    });

    // Don't try anything else - just return
    return;
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

  // Extract m3u8 filename (used for ZIP file and bash script)
  const m3u8FileName = manifest.m3u8Url.substring(manifest.m3u8Url.lastIndexOf('/') + 1).split('?')[0];

  // Generate timestamp once - will be used for both ZIP and MP4 filenames
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Use title if available, otherwise fall back to m3u8 filename
  const videoBaseName = manifest.title
    ? sanitizeFilename(manifest.title)
    : (m3u8FileName.replace('.m3u8', '') || 'output');

  // MP4 filename (uses same timestamp as ZIP)
  const outputFileName = `${videoBaseName}-${timestamp}.mp4`;

  // Parse m3u8 to get segment URLs first (needed for template replacement)
  const segmentUrls = parseM3U8(manifest.m3u8Content, manifest.m3u8Url);

  if (segmentUrls.length === 0) {
    throw new Error('No segments found in m3u8 file');
  }

  // Parse m3u8 to get initialization segment URLs from #EXT-X-MAP tags
  const initSegmentUrls = parseInitSegments(manifest.m3u8Content, manifest.m3u8Url);
  logger.log(` Found ${initSegmentUrls.length} initialization segment(s)`);

  // Create URL-to-filename mappings for both regular segments and init segments
  // Only applies unique naming when filenames are duplicated
  const segmentUrlToFilename = createUrlToFilenameMap(segmentUrls, 'segment.ts');
  const initSegmentUrlToFilename = createUrlToFilenameMap(initSegmentUrls, 'init.mp4');

  // Collect all segment filenames for safe cleanup in bash script
  const allSegmentFilenames: string[] = [];
  for (const filename of segmentUrlToFilename.values()) {
    allSegmentFilenames.push(filename);
  }
  for (const filename of initSegmentUrlToFilename.values()) {
    allSegmentFilenames.push(filename);
  }

  // Build safe cleanup command - explicit filenames instead of wildcards
  // Quote each filename to handle spaces/special characters safely
  const segmentFilesCleanup = allSegmentFilenames.length > 0
    ? allSegmentFilenames.map(filename => `"${filename}"`).join(' ')
    : '';

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
    .replace('{{OUTPUT_FILE}}', outputFileName)
    .replace('{{SEGMENT_FILES}}', segmentFilesCleanup);

  zip.file('compile_video.sh', bashScriptContent);

  // Log mapping for debugging
  logger.log(` Created mapping for ${segmentUrlToFilename.size} regular segments and ${initSegmentUrlToFilename.size} init segments`);
  if (segmentUrls.length > 0) {
    const firstUrl = segmentUrls[0];
    const firstFilename = segmentUrlToFilename.get(firstUrl);
    logger.log(` Sample mapping: ${firstUrl.substring(0, 80)}... -> ${firstFilename}`);
  }

  // Combine mappings for m3u8 modification
  const allUrlToFilename = new Map<string, string>([...segmentUrlToFilename, ...initSegmentUrlToFilename]);

  // Now modify m3u8 content to use the mapped filenames
  const modifiedM3U8Content = modifyM3U8ForLocalFiles(manifest.m3u8Content, manifest.m3u8Url, allUrlToFilename);

  // Add m3u8 file to ZIP
  zip.file(m3u8FileName, modifiedM3U8Content);

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
    logger.log('[Stream Video Saver] Downloading initialization segments...');
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

        // Use the filename from the mapping (handles duplicates automatically)
        const fileName = initSegmentUrlToFilename.get(url);
        if (!fileName) {
          logger.error(` ERROR: No filename found in mapping for init segment URL: ${url}`);
          throw new Error(`Could not get filename from init segment URL mapping for: ${url.substring(0, 100)}`);
        }

        // Validate filename is not empty
        if (!fileName || fileName.trim().length === 0) {
          logger.error(` ERROR: Empty filename for init segment URL: ${url}`);
          throw new Error(`Sanitization resulted in empty filename for: ${url.substring(0, 100)}`);
        }

        // Convert blob to ArrayBuffer for better memory efficiency with large files
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(fileName, arrayBuffer, { binary: true });
        logger.log(` Added init segment to ZIP: ${fileName} (${blobSize} bytes)`);
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

        logger.log(` Downloaded init segment: ${fileName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(` Failed to download init segment ${url}:`, errorMessage);
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

        // Use the filename from the mapping (handles duplicates automatically)
        const fileName = segmentUrlToFilename.get(url);
        if (!fileName) {
          logger.error(` ERROR: No filename found in mapping for segment URL: ${url}`);
          throw new Error(`Could not get filename from segment URL mapping for: ${url.substring(0, 100)}`);
        }

        // Validate filename is not empty
        if (!fileName || fileName.trim().length === 0) {
          logger.error(` ERROR: Empty filename for segment URL: ${url}`);
          throw new Error(`Sanitization resulted in empty filename for: ${url.substring(0, 100)}`);
        }

        // Convert blob to ArrayBuffer for better memory efficiency with large files
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(fileName, arrayBuffer, { binary: true });
        logger.log(` Added segment to ZIP: ${fileName} (${blobSize} bytes)`);
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
        logger.error(` Error downloading segment ${url}:`, errorMessage);
        // Track failed segment for retry instead of failing immediately
        failedSegments.push(url);
      }
    }));
  }

  // Retry failed init segments
  if (failedInitSegments.length > 0) {
    logger.log(` Retrying ${failedInitSegments.length} failed init segment(s)...`);
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

        // Use the filename from the mapping (handles duplicates automatically)
        const fileName = initSegmentUrlToFilename.get(url);
        if (!fileName) {
          logger.error(` ERROR: No filename found in mapping for init segment URL: ${url}`);
          throw new Error(`Could not get filename from init segment URL mapping for: ${url.substring(0, 100)}`);
        }

        // Validate filename is not empty
        if (!fileName || fileName.trim().length === 0) {
          logger.error(` ERROR: Empty filename for init segment URL: ${url}`);
          throw new Error(`Sanitization resulted in empty filename for: ${url.substring(0, 100)}`);
        }

        // Convert blob to ArrayBuffer for better memory efficiency with large files
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(fileName, arrayBuffer, { binary: true });
        logger.log(` Added init segment to ZIP: ${fileName} (${blobSize} bytes)`);
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

        logger.log(` Successfully retried init segment: ${fileName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(` Failed to retry init segment ${url}:`, errorMessage);
        throw new Error(`Failed to download initialization segment after retry: ${errorMessage}`);
      }
    }
  }

  // Retry failed regular segments
  if (failedSegments.length > 0) {
    logger.log(` Retrying ${failedSegments.length} failed segment(s)...`);

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

        // Use the filename from the mapping (handles duplicates automatically)
        const fileName = segmentUrlToFilename.get(url);
        if (!fileName) {
          logger.error(` ERROR: No filename found in mapping for segment URL: ${url}`);
          throw new Error(`Could not get filename from segment URL mapping for: ${url.substring(0, 100)}`);
        }

        // Validate filename is not empty
        if (!fileName || fileName.trim().length === 0) {
          logger.error(` ERROR: Empty filename for segment URL: ${url}`);
          throw new Error(`Sanitization resulted in empty filename for: ${url.substring(0, 100)}`);
        }

        // Convert blob to ArrayBuffer for better memory efficiency with large files
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(fileName, arrayBuffer, { binary: true });
        logger.log(` Added segment to ZIP: ${fileName} (${blobSize} bytes)`);
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

        logger.log(` Successfully retried segment: ${fileName}`);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(` Failed to retry segment ${url}:`, errorMessage);
          // Don't throw on retry failure - we'll continue with partial download
          // Log a warning instead
          logger.warn(` Segment ${url} failed even after retry. Download may be incomplete.`);
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

  // Log summary before ZIP generation
  logger.groupCollapsed('[Stream Video Saver] Download summary before ZIP generation');
  logger.log(`Total segments: ${total}`);
  logger.log(`Successfully downloaded: ${downloaded}`);
  logger.log(`Failed segments: ${failedSegments.length}`);
  logger.log(`Failed init segments: ${failedInitSegments.length}`);
  logger.log(`Total bytes downloaded: ${downloadedBytes}`);

  // Count files in ZIP
  let fileCount = 0;
  zip.forEach(() => { fileCount++; });
  logger.log(`Files in ZIP before generation: ${fileCount}`);
  logger.groupEnd();

  // Warn if no segments were downloaded
  if (downloaded === 0) {
    logger.error('[Stream Video Saver] WARNING: No segments were successfully downloaded! ZIP will only contain m3u8 and bash script.');
  }

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
  logger.log('[Stream Video Saver] Generating ZIP file...');
  let zipArrayBuffer: ArrayBuffer;
  try {
    zipArrayBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(` ERROR: Failed to generate ZIP: ${errorMessage}`);
    throw new Error(`Failed to generate ZIP file: ${errorMessage}`);
  }
  const zipSize = zipArrayBuffer.byteLength;
  logger.log(` ZIP generated successfully: ${zipSize} bytes (${(zipSize / 1024 / 1024).toFixed(2)} MB)`);

  // Validate ZIP size
  if (zipSize === 0) {
    throw new Error('Generated ZIP file is empty (0 bytes). This indicates no files were added to the ZIP.');
  }

  // Update progress with ZIP size - ZIP generation is complete, show success color
  notifyDownloadProgress(downloadId, {
    downloaded,
    total,
    status: 'creating_zip',
    downloadedBytes,
    totalBytes,
    downloadSpeed: 0,
    zipSize
  }, true); // zipGenerated = true

  // Check if cancelled after ZIP generation
  if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
    throw new Error('Download cancelled');
  }

  // Chrome has a ~2MB limit for data URLs, so for large files we need a different approach
  // For files > 50MB, we'll use a content script to create a Blob URL
  const MAX_DATA_URL_SIZE = 50 * 1024 * 1024; // 50MB limit for data URLs

  // Use the same timestamp that was used for the MP4 filename in the bash script
  // This ensures ZIP and MP4 have matching timestamps
  // Note: timestamp is already defined earlier in the function (line 1156)
  const zipBaseName = manifest.title
    ? sanitizeFilename(manifest.title)
    : (manifest.m3u8FileName.replace('.m3u8', '') || 'video');

  // Use the same timestamp variable that was used for outputFileName
  const zipFileName = `${zipBaseName}-${timestamp}.zip`;

  if (zipSize > MAX_DATA_URL_SIZE) {
    // For large files, send chunks via sendMessage to content script
    logger.log(` ZIP file is large (${(zipSize / 1024 / 1024).toFixed(2)} MB), sending chunks to content script`);

    // Find the tab where the manifest was captured
    const tabId = manifest.tabId;
    if (!tabId || tabId < 0) {
      throw new Error('Cannot download large ZIP: No tab ID available for chunk transfer');
    }

    try {

      // Use chrome.storage.local to store the ArrayBuffer
      // Note: chrome.storage has a 10MB per item limit, so we'll need to chunk it
      // For now, let's try using IndexedDB via a content script
      // Actually, let's try sending it in chunks if it's too large
      const MAX_MESSAGE_SIZE = 50 * 1024 * 1024; // 50MB limit for sendMessage

      if (zipSize > MAX_MESSAGE_SIZE) {
        // File is too large for a single sendMessage, send ArrayBuffer in chunks
        // sendMessage has ~60-100MB limit per message, so we'll send 40MB chunks
        const CHUNK_SIZE = 40 * 1024 * 1024; // 40MB chunks (under sendMessage limit)
        const totalChunks = Math.ceil(zipArrayBuffer.byteLength / CHUNK_SIZE);

        logger.log(` Sending ZIP to content script in ${totalChunks} chunk(s)...`);

        // Send chunks to content script sequentially
        // Convert ArrayBuffer chunks to base64 strings (ArrayBuffers are transferred, not copied)
        const bytes = new Uint8Array(zipArrayBuffer);
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, bytes.length);
          const chunk = bytes.subarray(start, end);

          // Convert chunk to base64 string (this can be copied, not transferred)
          let binary = '';
          const chunkSize = 8192; // Process in 8KB sub-chunks
          for (let j = 0; j < chunk.length; j += chunkSize) {
            const subChunk = chunk.subarray(j, j + chunkSize);
            binary += String.fromCharCode.apply(null, Array.from(subChunk));
          }
          const chunkBase64 = btoa(binary);

          await chrome.tabs.sendMessage(tabId, {
            action: 'receiveZipChunk',
            chunkIndex: i,
            totalChunks: totalChunks,
            chunkDataBase64: chunkBase64, // Send as base64 string instead of ArrayBuffer
            mimeType: 'application/zip',
            filename: zipFileName
          });

          // Update badge to show chunk sending progress (ZIP is already generated, show success color)
          if (i % Math.max(1, Math.floor(totalChunks / 10)) === 0 || i === totalChunks - 1) {
            const sendingProgress = {
              downloaded: i + 1,
              total: totalChunks,
              status: 'creating_zip' as DownloadStatus,
              downloadedBytes,
              totalBytes,
              downloadSpeed: 0,
              zipSize
            };
            notifyDownloadProgress(downloadId, sendingProgress, true);
          }
        }

        // Request content script to create Blob URL
        logger.log(` All chunks sent, requesting content script to create Blob URL...`);
        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'createBlobUrlFromChunks',
          totalChunks: totalChunks,
          mimeType: 'application/zip',
          filename: zipFileName
        });

        if (!response) {
          throw new Error('Failed to create Blob URL from chunks: No response from content script');
        }

        if (response.error) {
          throw new Error(`Failed to create Blob URL from chunks: ${response.error}`);
        }

        // Handle different response types
        if (response.success && response.method === 'anchor') {
          // Content script triggered download via anchor element (for large files)
          logger.log(` Download triggered via anchor element in content script`);

          // Update progress to complete
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

          // Request content script to clean up chunks
          chrome.tabs.sendMessage(tabId, {
            action: 'cleanupZipChunks',
            totalChunks: totalChunks
          }).catch(() => {
            // Ignore errors during cleanup
          });
          return;
        }

        if (!response.dataUrl) {
          throw new Error('Failed to create data URL from chunks: No dataUrl in response');
        }

        const dataUrl = response.dataUrl;
        logger.log(` Received data URL from content script (${(dataUrl.length / 1024 / 1024).toFixed(2)} MB)`);

        // Use the data URL for download (background script has access to chrome.downloads)
        // Clear badge when download starts
        chrome.action.setBadgeText({ text: '' });

        chrome.downloads.download({
          url: dataUrl,
          filename: zipFileName,
          saveAs: true
        }, (_chromeDownloadId?: number) => {
          // Request content script to clean up chunks after download starts
          chrome.tabs.sendMessage(tabId, {
            action: 'cleanupZipChunks',
            totalChunks: totalChunks
          }).catch(() => {
            // Ignore errors during cleanup
          });

          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || 'Unknown error';
            logger.error(` Error downloading ZIP: ${errorMessage}`);
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
      } else {
        // File is small enough for sendMessage
        logger.log(` Sending ${(zipArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB ArrayBuffer to content script...`);
        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'createBlobUrl',
          arrayBuffer: zipArrayBuffer,
          mimeType: 'application/zip'
        });

        if (!response || !response.blobUrl) {
          throw new Error('Failed to create Blob URL via content script: No response or missing blobUrl');
        }

        const blobUrl = response.blobUrl;
        logger.log(` Created Blob URL: ${blobUrl.substring(0, 100)}...`);

        // Use the Blob URL for download
        // Clear badge when download starts
        chrome.action.setBadgeText({ text: '' });

        chrome.downloads.download({
          url: blobUrl,
          filename: zipFileName,
          saveAs: true
        }, (_chromeDownloadId?: number) => {
          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || 'Unknown error';
            logger.error(` Error downloading ZIP: ${errorMessage}`);
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(` Failed to create Blob URL: ${errorMessage}`);
      throw new Error(`Failed to prepare large ZIP for download (${(zipSize / 1024 / 1024).toFixed(2)} MB): ${errorMessage}`);
    }
  } else {
    // For smaller files, use data URL
    logger.log(` Converting ZIP to base64 data URL (${(zipSize / 1024 / 1024).toFixed(2)} MB)...`);

    // Convert ArrayBuffer to base64 data URL for chrome.downloads API
    // Use chunked conversion to avoid stack overflow with large files
    const bytes = new Uint8Array(zipArrayBuffer);
    let binary = '';
    const chunkSize = 8192; // Process in 8KB chunks
    const totalChunks = Math.ceil(bytes.length / chunkSize);
    let processedChunks = 0;

    try {
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

      logger.log(` Converting ${binary.length} character binary string to base64...`);
      const base64 = btoa(binary);
      logger.log(` Base64 conversion complete: ${base64.length} characters`);

      const dataUrl = `data:application/zip;base64,${base64}`;
      logger.log(` Data URL created: ${dataUrl.length} characters`);

      // Create download using chrome.downloads API
      // Clear badge when download starts
      chrome.action.setBadgeText({ text: '' });

      chrome.downloads.download({
        url: dataUrl,
        filename: zipFileName,
        saveAs: true
      }, (_chromeDownloadId?: number) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || 'Unknown error';
          logger.error(` Error downloading ZIP: ${errorMessage}`);
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(` Error during base64 conversion: ${errorMessage}`);
      throw new Error(`Failed to convert ZIP to data URL: ${errorMessage}`);
    }
  }
}

/**
 * Modifies m3u8 content to use local filenames instead of full URLs.
 * Uses the provided URL-to-filename mapping to ensure consistent naming (handles duplicates).
 * @param content - The original m3u8 file content
 * @param baseUrl - The base URL of the m3u8 file (used for resolving relative URLs to absolute URLs)
 * @param urlToFilename - Map from segment URL to unique filename (handles duplicates)
 * @returns Modified m3u8 content with local filenames
 */
function modifyM3U8ForLocalFiles(content: string, baseUrl: string, urlToFilename: Map<string, string>): string {
  const lines = content.split('\n');
  const modifiedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Handle #EXT-X-MAP tags - update URI to use local filename from mapping
    if (trimmedLine.startsWith('#EXT-X-MAP:')) {
      const uriMatch = trimmedLine.match(/URI="([^"]+)"/);
      if (uriMatch && uriMatch[1]) {
        let uri = uriMatch[1];
        // Resolve relative URI to absolute URL if needed
        try {
          if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
            // Relative URI - resolve against base URL
            const baseUrlObj = new URL(baseUrl);
            uri = new URL(uri, baseUrlObj.origin + baseUrlObj.pathname.substring(0, baseUrlObj.pathname.lastIndexOf('/') + 1)).href;
          }
          // Look up filename in mapping
          const filename = urlToFilename.get(uri);
          if (filename) {
            // Replace the URI in the tag with just the filename
            const modifiedLine = trimmedLine.replace(/URI="[^"]+"/, `URI="${filename}"`);
            modifiedLines.push(modifiedLine);
            logger.log(` Updated #EXT-X-MAP URI: ${uriMatch[1]} -> ${filename}`);
            continue;
          }
        } catch (error) {
          logger.warn(` Failed to resolve or map init segment URI: ${uriMatch[1]}`, error);
        }
      }
      // If we couldn't map it, keep the original line
      modifiedLines.push(line);
      continue;
    }

    // Keep other comments and empty lines as-is
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      modifiedLines.push(line);
      continue;
    }

    // This is a segment URL line - use filename from mapping
    try {
      let segmentUrl = trimmedLine;
      // Resolve relative URL to absolute URL if needed
      if (!segmentUrl.startsWith('http://') && !segmentUrl.startsWith('https://')) {
        // Relative URL - resolve against base URL
        const baseUrlObj = new URL(baseUrl);
        segmentUrl = new URL(segmentUrl, baseUrlObj.origin + baseUrlObj.pathname.substring(0, baseUrlObj.pathname.lastIndexOf('/') + 1)).href;
      }
      // Look up filename in mapping
      const filename = urlToFilename.get(segmentUrl);
      if (filename) {
        modifiedLines.push(filename);
      } else {
        // If not found in mapping, keep original (shouldn't happen but safe fallback)
        logger.warn(` Segment URL not found in mapping: ${segmentUrl}`);
        modifiedLines.push(line);
      }
    } catch (error) {
      // If URL resolution fails, keep original line
      logger.warn(` Failed to resolve or map segment URL: ${trimmedLine}`, error);
      modifiedLines.push(line);
    }
  }

  return modifiedLines.join('\n');
}

/**
 * Updates the extension badge to show download progress.
 * @param progress - Progress information object
 * @param zipGenerated - Whether ZIP generation has completed (for success color)
 * @param hasError - Whether there was an error (for error color)
 */
function updateBadge(progress: DownloadProgress, zipGenerated: boolean = false, hasError: boolean = false): void {
  if (progress.status === 'complete' || progress.status === 'cancelled') {
    // Clear badge when download is complete or cancelled
    chrome.action.setBadgeText({ text: '' });
  } else if (hasError) {
    // Show error indicator
    chrome.action.setBadgeText({ text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ color: '#f44336' }); // Red for errors
  } else if (progress.status === 'creating_zip') {
    if (zipGenerated && progress.zipSize) {
      // ZIP generation completed successfully - show success color
      chrome.action.setBadgeText({ text: 'ZIP' });
      chrome.action.setBadgeBackgroundColor({ color: '#4caf50' }); // Green for success
    } else {
      // Still creating ZIP - show orange
      chrome.action.setBadgeText({ text: 'ZIP' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff9800' }); // Orange for zipping
    }
  } else if (progress.status === 'downloading') {
    // Show percentage on badge during segment download
    const percent = Math.round((progress.downloaded / progress.total) * 100);
    chrome.action.setBadgeText({ text: `${percent}%` });
    chrome.action.setBadgeBackgroundColor({ color: '#4caf50' }); // Green for downloading
  } else {
    // Default: show status text
    chrome.action.setBadgeText({ text: progress.status.substring(0, 4).toUpperCase() });
    chrome.action.setBadgeBackgroundColor({ color: '#2196f3' }); // Blue for other statuses
  }
}

/**
 * Sends download progress update to the popup and updates the extension badge.
 * @param downloadId - The ID of the download
 * @param progress - Progress information object
 * @param zipGenerated - Whether ZIP generation has completed (for success color)
 */
function notifyDownloadProgress(downloadId: string, progress: DownloadProgress, zipGenerated: boolean = false): void {
  // Update extension badge
  updateBadge(progress, zipGenerated, false);

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
 * Sends download error notification to the popup and updates the badge.
 * @param downloadId - The ID of the download that failed
 * @param error - Error message describing what went wrong
 */
function notifyDownloadError(downloadId: string, error: string): void {
  // Show error badge
  const download = activeDownloads.get(downloadId);
  if (download) {
    updateBadge(download.progress, false, true);
  } else {
    // No download state, show generic error badge
    chrome.action.setBadgeText({ text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ color: '#f44336' }); // Red for errors
  }

  // Send message to popup
  chrome.runtime.sendMessage({
    action: 'downloadError',
    downloadId,
    error
  } as ExtensionMessage).catch(() => {
    // Ignore if no listeners
  });
}

