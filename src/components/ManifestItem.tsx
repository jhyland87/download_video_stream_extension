/**
 * @fileoverview Component for displaying a single manifest item.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import CloseIcon from '@mui/icons-material/Close';
import CancelIcon from '@mui/icons-material/Cancel';
import type { ManifestItemProps } from '../types';
import { PreviewImage } from './PreviewImage';
import {
  formatBytes,
  formatSpeed,
  formatDuration,
  formatPageUrl
} from '../utils/popup';

/**
 * Component for displaying a single manifest item.
 */
export const ManifestItem = ({ manifest, onDownload, onClear, downloadProgress, onCancel, isCompleted }: ManifestItemProps & { isCompleted: boolean }) => {
  const date = new Date(manifest.capturedAt);
  const timeStr = date.toLocaleTimeString();
  const displayTitle = manifest.title || manifest.fileName;
  const formattedPageUrl = formatPageUrl(manifest.pageUrl);

  const infoParts: string[] = [];

  if (manifest.resolution) {
    infoParts.push(`${manifest.resolution.width}×${manifest.resolution.height}`);
  }

  if (manifest.duration) {
    infoParts.push(formatDuration(manifest.duration));
  }

  infoParts.push(`${manifest.segmentCount} segments`);
  infoParts.push(`Captured at ${timeStr}`);

  const infoText = infoParts.join(' • ');

  const percent = downloadProgress ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100) : 0;
  const isCanceled = downloadProgress?.status === 'canceled';
  const isActive = downloadProgress && downloadProgress.status !== 'complete' && !isCanceled;

  let progressInfoText = 'Starting download...';
  if (downloadProgress) {
    if (downloadProgress.status === 'creating_zip') {
      if (downloadProgress.zipSize) {
        progressInfoText = `Created ${formatBytes(downloadProgress.zipSize)} zip file`;
      } else if (downloadProgress.totalBytes) {
        progressInfoText = `Compressing ${formatBytes(downloadProgress.totalBytes)} into zip archive...`;
      } else {
        progressInfoText = 'Creating ZIP file...';
      }
    } else if (downloadProgress.status === 'downloading') {
      const segments = `${downloadProgress.downloaded}/${downloadProgress.total}`.padEnd(10);
      const speed = downloadProgress.downloadSpeed && downloadProgress.downloadSpeed > 0
        ? formatSpeed(downloadProgress.downloadSpeed).padEnd(12)
        : '            ';
      const size = downloadProgress.downloadedBytes !== undefined
        ? formatBytes(downloadProgress.downloadedBytes).padEnd(12)
        : '            ';
      progressInfoText = `Segments: ${segments} ${speed} ${size}`.trimEnd();
    }
  }

  return (
    <Card className="manifest-item-card" data-manifest-id={manifest.id}>
      <Box className="manifest-item-top-section">
        {manifest.previewUrls && manifest.previewUrls.length > 0 && (
          <PreviewImage previewUrls={manifest.previewUrls} />
        )}
        <Box className="manifest-item-content-box">
          <Box className="manifest-item-header-box">
            <Typography variant="subtitle2" className="manifest-item-title">
              {displayTitle}
            </Typography>
            <IconButton
              size="small"
              onClick={() => onClear(manifest.id)}
              className="manifest-item-close-button"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          {formattedPageUrl && manifest.pageUrl && (
            <Link
              href={manifest.pageUrl}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                chrome.tabs.create({ url: manifest.pageUrl });
              }}
              className="manifest-item-page-link"
              color="text.secondary"
              title={manifest.pageUrl}
            >
              {formattedPageUrl}
            </Link>
          )}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" className="manifest-item-info-text">
        {infoText}
      </Typography>
      <Box className="manifest-item-actions-section">
        {isActive && (
          <Box className="manifest-item-progress-container-box">
            <Box className="manifest-item-progress-bar-container">
              <LinearProgress
                variant="determinate"
                value={percent}
                color={isCanceled ? 'error' : 'primary'}
                className="manifest-item-progress-bar"
              />
              {!isCanceled && (
                <IconButton
                  size="small"
                  onClick={() => onCancel(manifest.id)}
                  className="manifest-item-progress-cancel-button"
                >
                  <CancelIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
            {!isCanceled && (
              <Typography variant="caption" className="manifest-item-progress-info-text">
                {progressInfoText}
              </Typography>
            )}
            {isCanceled && (
              <Typography variant="caption" className="manifest-item-progress-canceled-text">
                Download Canceled
              </Typography>
            )}
          </Box>
        )}
        {!isActive && (
          <Button
            variant={isCompleted ? 'outlined' : 'contained'}
            size="small"
            fullWidth
            onClick={() => onDownload(manifest.id)}
            className="manifest-item-download-button"
          >
            {isCompleted ? 'Zip Downloaded' : 'Download ZIP'}
          </Button>
        )}
      </Box>
    </Card>
  );
};
