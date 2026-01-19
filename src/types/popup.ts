/**
 * Type definitions for popup React components
 */

import type { ManifestSummary, DownloadProgress } from './index.js';

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
}

/**
 * Props for the ProgressBar component
 */
export interface ProgressBarProps {
  progress: DownloadProgress | null;
  onCancel: () => void;
}
