/**
 * Type definitions for the Stream Video Saver extension
 */

// Import ignore list types
import type {
  GetIgnoreListMessage,
  AddToIgnoreListMessage,
  RemoveFromIgnoreListMessage,
  IgnoreListResponse
} from './ignore-list';

/**
 * Video resolution information
 */
export interface VideoResolution {
  width: number;
  height: number;
}

/**
 * Manifest object stored in history
 */
export interface Manifest {
  id: string;
  m3u8Url: string;
  m3u8Content: string;
  m3u8FileName: string;
  title?: string; // Video title or page title
  expectedSegments: string[];
  capturedAt: string;
  resolution?: VideoResolution; // Video resolution (width x height)
  duration?: number; // Video duration in seconds
  tabId?: number; // Tab ID where the manifest was captured (for title extraction)
  pageDomain?: string; // Domain of the page where the manifest was captured (for ignore list filtering)
  pageUrl?: string; // Full URL of the page where the manifest was captured
  previewUrls?: string[]; // Array of data URLs of video frame previews (base64 images) captured at different timestamps
}

/**
 * Simplified manifest object returned to popup
 */
export interface ManifestSummary {
  id: string;
  fileName: string;
  title?: string; // Video title or page title
  url: string;
  segmentCount: number;
  capturedAt: string;
  resolution?: VideoResolution; // Video resolution (width x height)
  duration?: number; // Video duration in seconds
  pageUrl?: string; // Full URL of the page where the manifest was captured
  pageDomain?: string; // Domain of the page where the manifest was captured (for grouping and ignore list)
  previewUrls?: string[]; // Array of data URLs of video frame previews (base64 images) captured at different timestamps
}

/**
 * ManifestSummary with deduplication helper keys
 * Used internally for grouping and deduplication logic
 */
export interface ManifestSummaryWithDedupKeys extends ManifestSummary {
  urlKey: string; // URL without query params for deduplication
  dedupKey: string; // Title + segment count or URL for deduplication
}

/**
 * ManifestSummary with URL key for deduplication
 * Used internally for deduplication logic that only needs urlKey
 */
export interface ManifestSummaryWithUrlKey extends ManifestSummary {
  urlKey: string; // URL without query params for deduplication
}

/**
 * Chrome webRequest details with optional tabId
 * Used when processing m3u8 content that may have tabId information
 */
export type WebRequestBodyDetailsWithTabId = Omit<chrome.webRequest.WebRequestBodyDetails, 'tabId'> & {
  tabId?: number;
};

/**
 * Chrome webRequest details with optional request headers
 * Used when handling completed requests that may include request headers
 */
export interface WebRequestBodyDetailsWithHeaders extends chrome.webRequest.WebRequestBodyDetails {
  requestHeaders?: chrome.webRequest.HttpHeader[];
}

/**
 * Icon types for different extension states
 */
export type IconType = 'default' | 'downloading' | 'compressing' | 'saving' | 'found-video';

/**
 * Download format type
 */
export type DownloadFormat = 'zip';

/**
 * Download status type
 */
export type DownloadStatus = 'starting' | 'downloading' | 'creating_zip' | 'complete' | 'cancelled';

/**
 * Download progress information
 */
export interface DownloadProgress {
  downloaded: number; // Number of segments downloaded
  total: number; // Total number of segments
  status: DownloadStatus;
  downloadedBytes?: number; // Total bytes downloaded
  totalBytes?: number; // Total bytes to download
  downloadSpeed?: number; // Download speed in bytes per second
  zipSize?: number; // ZIP file size in bytes (after generation)
}

/**
 * Active download state
 */
export interface ActiveDownload {
  manifestId: string;
  format: DownloadFormat;
  cancelled: boolean;
  abortController: AbortController;
  progress: DownloadProgress;
  windowId: number | null; // Window ID where the download was initiated
}

/**
 * Message actions sent between popup and background
 */
export type MessageAction =
  | 'getStatus'
  | 'getManifestData'
  | 'clearManifest'
  | 'startDownload'
  | 'cancelDownload'
  | 'getDownloadStatus'
  | 'downloadProgress'
  | 'downloadError'
  | 'manifestCaptured'
  | 'previewUpdated'
  | 'previewFrameReady'
  | 'segmentDownloaded'
  | 'm3u8ResponseCaptured'
  | 'm3u8FetchError'
  | 'getIgnoreList'
  | 'addToIgnoreList'
  | 'removeFromIgnoreList'
  | 'getCurrentTab'
  | 'getVideoTitle'
  | 'getVideoPreview'
  | 'createBlobUrl'
  | 'receiveZipChunk'
  | 'createBlobUrlFromChunks'
  | 'cleanupZipChunks'
  | 'createBlobUrlFromStorage'; // Legacy message, kept for compatibility

/**
 * Base message interface
 */
export interface BaseMessage {
  action: MessageAction;
}

/**
 * Get status message
 */
export interface GetStatusMessage extends BaseMessage {
  action: 'getStatus';
  windowId?: number; // Optional window ID to filter manifests by window
}

/**
 * Get manifest data message
 */
export interface GetManifestDataMessage extends BaseMessage {
  action: 'getManifestData';
  manifestId: string;
}

/**
 * Clear manifest message
 */
export interface ClearManifestMessage extends BaseMessage {
  action: 'clearManifest';
  manifestId?: string;
}

/**
 * Start download message
 */
export interface StartDownloadMessage extends BaseMessage {
  action: 'startDownload';
  manifestId: string;
  format: DownloadFormat;
}

/**
 * Cancel download message
 */
export interface CancelDownloadMessage extends BaseMessage {
  action: 'cancelDownload';
  downloadId: string;
}

/**
 * Get download status message
 */
export interface GetDownloadStatusMessage extends BaseMessage {
  action: 'getDownloadStatus';
}

/**
 * Download progress message
 */
export interface DownloadProgressMessage extends BaseMessage {
  action: 'downloadProgress';
  downloadId: string;
  downloaded: number;
  total: number;
  status: DownloadStatus;
  downloadedBytes?: number; // Total bytes downloaded
  totalBytes?: number; // Total bytes to download
  downloadSpeed?: number; // Download speed in bytes per second
  zipSize?: number; // ZIP file size in bytes (after generation)
}

/**
 * Download error message
 */
export interface DownloadErrorMessage extends BaseMessage {
  action: 'downloadError';
  downloadId: string;
  error: string;
}

/**
 * Manifest captured message
 */
export interface ManifestCapturedMessage extends BaseMessage {
  action: 'manifestCaptured';
  manifestId: string;
  fileName: string;
  title?: string;
  segmentCount: number;
}

/**
 * Preview frame ready message (sent when a single preview frame is ready)
 */
export interface PreviewFrameReadyMessage extends BaseMessage {
  action: 'previewFrameReady';
  manifestId: string;
  frameUrl: string;
  frameIndex: number;
}

/**
 * Preview updated message (sent when preview frames are ready)
 */
export interface PreviewUpdatedMessage extends BaseMessage {
  action: 'previewUpdated';
  manifestId: string;
  previewUrls: string[];
}

/**
 * Segment downloaded message
 */
export interface SegmentDownloadedMessage extends BaseMessage {
  action: 'segmentDownloaded';
  segmentUrl: string;
}

/**
 * M3U8 response captured message (from content script)
 */
export interface M3U8ResponseCapturedMessage extends BaseMessage {
  action: 'm3u8ResponseCaptured';
  url: string;
  content: string;
  status: number;
  statusText: string;
}

/**
 * M3U8 fetch error message (from background script)
 */
export interface M3U8FetchErrorMessage extends BaseMessage {
  action: 'm3u8FetchError';
  url: string;
  status: number;
  statusText: string;
  error: string;
}

/**
 * Get current tab message
 */
export interface GetCurrentTabMessage extends BaseMessage {
  action: 'getCurrentTab';
}

/**
 * Get current tab response
 */
export interface GetCurrentTabResponse {
  url?: string;
  domain?: string;
  title?: string;
}

/**
 * Get video title message (content script)
 */
export interface GetVideoTitleMessage extends BaseMessage {
  action: 'getVideoTitle';
}

/**
 * Get video preview message (content script)
 */
export interface GetVideoPreviewMessage extends BaseMessage {
  action: 'getVideoPreview';
  manifestId?: string;
}

/**
 * Create blob URL message (content script)
 */
export interface CreateBlobUrlMessage extends BaseMessage {
  action: 'createBlobUrl';
  arrayBuffer: ArrayBuffer;
  mimeType: string;
}

/**
 * Receive ZIP chunk message (content script)
 */
export interface ReceiveZipChunkMessage extends BaseMessage {
  action: 'receiveZipChunk';
  chunkIndex: number;
  chunkDataBase64: string;
}

/**
 * Create blob URL from chunks message (content script)
 */
export interface CreateBlobUrlFromChunksMessage extends BaseMessage {
  action: 'createBlobUrlFromChunks';
  totalChunks: number;
  mimeType: string;
  filename: string;
}

/**
 * Cleanup ZIP chunks message (content script)
 */
export interface CleanupZipChunksMessage extends BaseMessage {
  action: 'cleanupZipChunks';
  totalChunks: number;
}

/**
 * Create blob URL from storage message (content script, legacy)
 * This is a legacy message kept for backward compatibility
 */
export interface CreateBlobUrlFromStorageMessage extends BaseMessage {
  action: 'createBlobUrlFromStorage';
  storageKey: string;
}

/**
 * Content script response types
 */
export interface GetVideoTitleResponse {
  title?: string | null;
}

export interface GetVideoPreviewResponse {
  previewUrls?: string[];
}

export interface CreateBlobUrlResponse {
  blobUrl?: string;
  error?: string;
}

export interface ReceiveZipChunkResponse {
  received?: boolean;
}

export interface CreateBlobUrlFromChunksResponse {
  success?: boolean;
  method?: string;
  dataUrl?: string;
  error?: string;
}

export interface CleanupZipChunksResponse {
  cleaned?: boolean;
}

/**
 * Union type for all content script responses
 */
export type ContentScriptResponse =
  | GetVideoTitleResponse
  | GetVideoPreviewResponse
  | CreateBlobUrlResponse
  | ReceiveZipChunkResponse
  | CreateBlobUrlFromChunksResponse
  | CleanupZipChunksResponse
  | { error: string };

/**
 * Union type for all messages
 */
export type ExtensionMessage =
  | GetStatusMessage
  | GetManifestDataMessage
  | ClearManifestMessage
  | StartDownloadMessage
  | CancelDownloadMessage
  | GetDownloadStatusMessage
  | DownloadProgressMessage
  | DownloadErrorMessage
  | ManifestCapturedMessage
  | PreviewUpdatedMessage
  | PreviewFrameReadyMessage
  | SegmentDownloadedMessage
  | M3U8ResponseCapturedMessage
  | M3U8FetchErrorMessage
  | GetIgnoreListMessage
  | AddToIgnoreListMessage
  | RemoveFromIgnoreListMessage
  | GetCurrentTabMessage
  | GetVideoTitleMessage
  | GetVideoPreviewMessage
  | CreateBlobUrlMessage
  | ReceiveZipChunkMessage
  | CreateBlobUrlFromChunksMessage
  | CleanupZipChunksMessage
  | CreateBlobUrlFromStorageMessage;

/**
 * Response for getStatus action
 */
export interface GetStatusResponse {
  manifestHistory: ManifestSummary[];
}

/**
 * Response for getManifestData action
 */
export interface GetManifestDataResponse {
  id?: string;
  m3u8Url?: string;
  m3u8Content?: string;
  m3u8FileName?: string;
  expectedSegments?: string[];
  error?: string;
}

/**
 * Response for getDownloadStatus action
 */
export interface GetDownloadStatusResponse {
  downloads: Array<{
    downloadId: string;
    manifestId: string;
    format: DownloadFormat;
    progress: DownloadProgress;
  }>;
}

/**
 * Success response
 */
export interface SuccessResponse {
  success: boolean;
}

/**
 * Union type for all responses
 */
export type ExtensionResponse =
  | GetStatusResponse
  | GetManifestDataResponse
  | GetDownloadStatusResponse
  | SuccessResponse
  | IgnoreListResponse
  | GetCurrentTabResponse
  | { error: string };

// Re-export popup component types
export type {
  PreviewImageProps,
  ManifestItemProps,
  ProgressBarProps
} from './popup';

// Re-export ignore list types
export type {
  IgnoreListAction,
  GetIgnoreListMessage,
  AddToIgnoreListMessage,
  RemoveFromIgnoreListMessage,
  IgnoreListResponse
} from './ignore-list';

// Re-export type guards from guards.ts for convenience
export {
  isMessageAction,
  isGetStatusMessage,
  isGetManifestDataMessage,
  isStartDownloadMessage,
  isCancelDownloadMessage,
  isClearManifestMessage,
  isGetDownloadStatusMessage,
  isDownloadProgressMessage,
  isDownloadErrorMessage,
  isManifestCapturedMessage,
  isHTMLElement,
  isHTMLDivElement,
  isHTMLButtonElement
} from './guards';

