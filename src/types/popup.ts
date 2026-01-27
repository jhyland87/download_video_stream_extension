/**
 * Type definitions for popup React components
 */

import type { ManifestSummary, DownloadProgress } from '.';

/**
 * Props for the PreviewImage component
 */
export interface PreviewImageProps {
  previewUrls: string[];
}

/**
 * Props for the ManifestItem component
 */
export interface ManifestItemProps {
  manifest: ManifestSummary;
  onDownload: (manifestId: string) => void;
  onClear: (manifestId: string) => void;
  downloadProgress?: DownloadProgress | null;
  onCancel: (manifestId: string) => void;
}

/**
 * Props for the ProgressBar component
 */
export interface ProgressBarProps {
  progress: DownloadProgress | null;
  onCancel: () => void;
}

/**
 * Download state for tracking downloads per manifest
 */
export interface DownloadState {
  downloadId: string;
  progress: DownloadProgress;
}

/**
 * Domain group interface for manifest grouping
 */
export interface DomainGroup {
  domain: string;
  manifests: ManifestSummary[];
  mostRecentCapture: string; // ISO timestamp of most recent manifest in group
}
