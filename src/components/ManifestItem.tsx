/**
 * @fileoverview Component for displaying a single manifest item.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import LinearProgress from '@mui/material/LinearProgress';
import IconButton from '@mui/material/IconButton';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload, faXmark, faX } from '@fortawesome/free-solid-svg-icons';
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
    console.log('downloadProgress', downloadProgress);
    if (downloadProgress.status === 'creating_zip') {
      if (downloadProgress.zipSize) {
        progressInfoText = `Created ${formatBytes(downloadProgress.zipSize)} zip file`;
      } else if (downloadProgress.totalBytes) {
        progressInfoText = `Compressing ${formatBytes(downloadProgress.totalBytes)} into zip archive...`;
      } else {
        progressInfoText = 'Creating ZIP file...';
      }
    } else if (downloadProgress.status === 'sending_chunks') {
      progressInfoText = `Sending ZIP file... (${downloadProgress.downloaded}/${downloadProgress.total} chunks)`;
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
            {manifest.pageUrl ? (
              <Typography
                variant="subtitle2"
                component="a"
                href={manifest.pageUrl}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  chrome.tabs.create({ url: manifest.pageUrl });
                }}
                className="manifest-item-title manifest-item-title-link"
                title={manifest.pageUrl}
                color="inherit"
              >
                {displayTitle}
              </Typography>
            ) : (
              <Typography variant="subtitle2" className="manifest-item-title">
                {displayTitle}
              </Typography>
            )}
            <IconButton
              size="small"
              onClick={() => onClear(manifest.id)}
              className="manifest-item-close-button"
            >
              <FontAwesomeIcon icon={faX} size="sm" />
            </IconButton>
          </Box>
        </Box>
      </Box>
      <Box className="manifest-item-status-row">
        {isActive ? (
          <>
            <Box className="manifest-item-progress-container">
              <LinearProgress
                variant="determinate"
                value={percent}
                color={isCanceled ? 'error' : 'primary'}
                className="manifest-item-progress-bar"
              />
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
            {!isCanceled && (
              <IconButton
                size="small"
                onClick={() => onCancel(manifest.id)}
                className="manifest-item-action-button manifest-item-cancel-button"
              >
                <FontAwesomeIcon icon={faXmark} size="sm" />
              </IconButton>
            )}
          </>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary" className="manifest-item-info-text">
              {infoText}
            </Typography>
            <IconButton
              size="small"
              onClick={() => onDownload(manifest.id)}
              className={`manifest-item-action-button manifest-item-download-button ${isCompleted ? 'completed' : ''}`}
              color={isCompleted ? 'default' : 'primary'}
            >
              <FontAwesomeIcon icon={faDownload} size="sm" />
            </IconButton>
          </>
        )}
      </Box>
    </Card>
  );
};
