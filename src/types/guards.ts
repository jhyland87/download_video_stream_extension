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
  ManifestCapturedMessage
} from './index.js';

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
