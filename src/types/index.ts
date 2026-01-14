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
  downloaded: number;
  total: number;
  status: DownloadStatus;
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
  | 'segmentDownloaded';

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
  | SegmentDownloadedMessage;

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


/**
 * Type guard to check if value is a valid message action
 */
export function isMessageAction(value: unknown): value is MessageAction {
  if (typeof value !== 'string') {
    return false;
  }
  const validActions: MessageAction[] = [
    'getStatus',
    'getManifestData',
    'clearManifest',
    'startDownload',
    'cancelDownload',
    'getDownloadStatus',
    'downloadProgress',
    'downloadError',
    'manifestCaptured',
    'segmentDownloaded'
  ];
  return validActions.includes(value as MessageAction);
}

/**
 * Type guard to check if object is a GetStatusMessage
 */
export function isGetStatusMessage(message: unknown): message is GetStatusMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return msg.action === 'getStatus';
}

/**
 * Type guard to check if object is a GetManifestDataMessage
 */
export function isGetManifestDataMessage(message: unknown): message is GetManifestDataMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return msg.action === 'getManifestData' && typeof msg.manifestId === 'string';
}

/**
 * Type guard to check if object is a StartDownloadMessage
 */
export function isStartDownloadMessage(message: unknown): message is StartDownloadMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return (
    msg.action === 'startDownload' &&
    typeof msg.manifestId === 'string' &&
    msg.format === 'zip'
  );
}

/**
 * Type guard to check if object is a CancelDownloadMessage
 */
export function isCancelDownloadMessage(message: unknown): message is CancelDownloadMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return msg.action === 'cancelDownload' && typeof msg.downloadId === 'string';
}

/**
 * Type guard to check if object is a ClearManifestMessage
 */
export function isClearManifestMessage(message: unknown): message is ClearManifestMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return msg.action === 'clearManifest';
}

/**
 * Type guard to check if object is a GetDownloadStatusMessage
 */
export function isGetDownloadStatusMessage(message: unknown): message is GetDownloadStatusMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return msg.action === 'getDownloadStatus';
}

/**
 * Type guard to check if object is a DownloadProgressMessage
 */
export function isDownloadProgressMessage(message: unknown): message is DownloadProgressMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return (
    msg.action === 'downloadProgress' &&
    typeof msg.downloadId === 'string' &&
    typeof msg.downloaded === 'number' &&
    typeof msg.total === 'number' &&
    typeof msg.status === 'string'
  );
}

/**
 * Type guard to check if object is a DownloadErrorMessage
 */
export function isDownloadErrorMessage(message: unknown): message is DownloadErrorMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return msg.action === 'downloadError' && typeof msg.error === 'string';
}

/**
 * Type guard to check if object is a ManifestCapturedMessage
 */
export function isManifestCapturedMessage(message: unknown): message is ManifestCapturedMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return (
    msg.action === 'manifestCaptured' &&
    typeof msg.manifestId === 'string' &&
    typeof msg.fileName === 'string' &&
    typeof msg.segmentCount === 'number'
  );
}

/**
 * Type guard to check if value is a non-null HTMLElement
 */
export function isHTMLElement(value: unknown): value is HTMLElement {
  return value !== null && value instanceof HTMLElement;
}

/**
 * Type guard to check if value is a non-null HTMLDivElement
 */
export function isHTMLDivElement(value: unknown): value is HTMLDivElement {
  return value !== null && value instanceof HTMLDivElement;
}

/**
 * Type guard to check if value is a non-null HTMLButtonElement
 */
export function isHTMLButtonElement(value: unknown): value is HTMLButtonElement {
  return value !== null && value instanceof HTMLButtonElement;
}

