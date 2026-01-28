/**
 * Type guards for the Stream Video Saver extension
 */

import type {
  MessageAction,
  GetStatusMessage,
  GetManifestDataMessage,
  StartDownloadMessage,
  CancelDownloadMessage,
  ClearManifestMessage,
  GetDownloadStatusMessage,
  DownloadProgressMessage,
  DownloadErrorMessage,
  ManifestCapturedMessage,
  GetVideoPreviewMessage,
  CreateBlobUrlMessage,
  ReceiveZipChunkMessage,
  CreateBlobUrlFromChunksMessage,
  CleanupZipChunksMessage
} from '.';

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
    typeof msg.manifestId === 'string' &&
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

/**
 * Type guard to check if a message is GetVideoPreviewMessage
 * @param message - The message to check
 * @returns True if message is GetVideoPreviewMessage
 */
export function isGetVideoPreviewMessage(message: { action: string }): message is GetVideoPreviewMessage {
  return message.action === 'getVideoPreview';
}

/**
 * Type guard to check if a message is CreateBlobUrlMessage
 * @param message - The message to check
 * @returns True if message is CreateBlobUrlMessage
 */
export function isCreateBlobUrlMessage(message: { action: string }): message is CreateBlobUrlMessage {
  return message.action === 'createBlobUrl' && 'arrayBuffer' in message && 'mimeType' in message;
}

/**
 * Type guard to check if a message is ReceiveZipChunkMessage
 * @param message - The message to check
 * @returns True if message is ReceiveZipChunkMessage
 */
export function isReceiveZipChunkMessage(message: { action: string }): message is ReceiveZipChunkMessage {
  return message.action === 'receiveZipChunk' && 'chunkIndex' in message && 'chunkDataBase64' in message;
}

/**
 * Type guard to check if a message is CreateBlobUrlFromChunksMessage
 * @param message - The message to check
 * @returns True if message is CreateBlobUrlFromChunksMessage
 */
export function isCreateBlobUrlFromChunksMessage(message: { action: string }): message is CreateBlobUrlFromChunksMessage {
  return message.action === 'createBlobUrlFromChunks' && 'totalChunks' in message && 'mimeType' in message && 'filename' in message;
}

/**
 * Type guard to check if a message is CleanupZipChunksMessage
 * @param message - The message to check
 * @returns True if message is CleanupZipChunksMessage
 */
export function isCleanupZipChunksMessage(message: { action: string }): message is CleanupZipChunksMessage {
  return message.action === 'cleanupZipChunks' && 'totalChunks' in message;
}

/**
 * Type guard to check if a message is CleanupDownloadsMessage
 * @param message - Message to check
 * @returns True if message is CleanupDownloadsMessage
 */
export function isCleanupDownloadsMessage(message: { action: string }): message is CleanupDownloadsMessage {
  return message.action === 'cleanupDownloads';
}

/**
 * Type guard to check if a value is an ArrayBuffer
 * @param value - The value to check
 * @returns True if value is an ArrayBuffer
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

/**
 * Type guard to check if FileReader result is a string (data URL)
 * @param value - The FileReader result to check
 * @returns True if value is a string
 */
export function isFileReaderStringResult(value: string | ArrayBuffer | null): value is string {
  return typeof value === 'string';
}
