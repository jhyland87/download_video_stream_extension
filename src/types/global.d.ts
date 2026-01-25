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
} from '.';

// Make types available globally for service worker
declare global {
  type Manifest = import('.').Manifest;
  type ManifestSummary = import('.').ManifestSummary;
  type DownloadFormat = import('.').DownloadFormat;
  type DownloadStatus = import('.').DownloadStatus;
  type DownloadProgress = import('.').DownloadProgress;
  type ActiveDownload = import('.').ActiveDownload;
  type ExtensionMessage = import('.').ExtensionMessage;
  type ExtensionResponse = import('.').ExtensionResponse;
  type GetStatusResponse = import('.').GetStatusResponse;
  type GetManifestDataResponse = import('.').GetManifestDataResponse;
  type GetDownloadStatusResponse = import('.').GetDownloadStatusResponse;
  type SuccessResponse = import('.').SuccessResponse;
}

export {};

