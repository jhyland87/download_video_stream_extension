/**
 * Type definitions for the Stream Video Saver extension
 */

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
  previewUrls?: string[]; // Array of data URLs of video frame previews (base64 images) captured at different timestamps
}

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
  | 'segmentDownloaded'
  | 'm3u8ResponseCaptured';

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
  | SegmentDownloadedMessage
  | M3U8ResponseCapturedMessage
  | M3U8FetchErrorMessage;

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
  | { error: string };

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
} from './guards.js';

