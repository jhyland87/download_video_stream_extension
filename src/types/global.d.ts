/**
 * Global type definitions for background service worker
 * These types are made available globally for use in service workers
 */

import type {
  Manifest,
  ManifestSummary,
  DownloadFormat,
  DownloadStatus,
  DownloadProgress,
  ActiveDownload,
  ExtensionMessage,
  ExtensionResponse,
  GetStatusResponse,
  GetManifestDataResponse,
  GetDownloadStatusResponse,
  SuccessResponse
} from './index.js';

// Make types available globally for service worker
declare global {
  type Manifest = import('./index.js').Manifest;
  type ManifestSummary = import('./index.js').ManifestSummary;
  type DownloadFormat = import('./index.js').DownloadFormat;
  type DownloadStatus = import('./index.js').DownloadStatus;
  type DownloadProgress = import('./index.js').DownloadProgress;
  type ActiveDownload = import('./index.js').ActiveDownload;
  type ExtensionMessage = import('./index.js').ExtensionMessage;
  type ExtensionResponse = import('./index.js').ExtensionResponse;
  type GetStatusResponse = import('./index.js').GetStatusResponse;
  type GetManifestDataResponse = import('./index.js').GetManifestDataResponse;
  type GetDownloadStatusResponse = import('./index.js').GetDownloadStatusResponse;
  type SuccessResponse = import('./index.js').SuccessResponse;
}

export {};

