/**
 * @fileoverview Popup React component for UI interaction and user interface management.
 * This component handles:
 * - Rendering manifest history
 * - Initiating ZIP downloads
 * - Displaying download progress
 * - Managing user interactions (clear, cancel, download)
 * - Communicating with background script
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from './themes';
import CssBaseline from '@mui/material/CssBaseline';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import SpeedDial from '@mui/material/SpeedDial';
import SpeedDialAction from '@mui/material/SpeedDialAction';
import SpeedDialIcon from '@mui/material/SpeedDialIcon';
import DeleteIcon from '@mui/icons-material/Delete';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import BlockIcon from '@mui/icons-material/Block';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import CancelIcon from '@mui/icons-material/Cancel';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Pagination from '@mui/material/Pagination';
import type {
  ManifestSummary,
  DownloadFormat,
  ExtensionMessage,
  ExtensionResponse,
  GetStatusResponse,
  GetDownloadStatusResponse,
  DownloadProgressMessage,
  DownloadErrorMessage,
  ManifestCapturedMessage,
  PreviewUpdatedMessage,
  M3U8FetchErrorMessage,
  DownloadProgress,
  PreviewImageProps,
  ManifestItemProps,
  ProgressBarProps,
  AddToIgnoreListMessage,
  DownloadState,
  CleanupDownloadsMessage,
  CleanupDownloadsResponse
} from './types';
import { logger } from './utils/logger';
import {
  formatBytes,
  formatSpeed,
  formatDuration,
  extractFilenameFromUrl,
  formatPageUrl,
  groupManifestsByDomain
} from './utils/popup';
import type { DomainGroup } from './types';

// CRITICAL: This should appear in console immediately when script loads
logger.log('popup.tsx loaded - script is executing');


/**
 * Component for displaying and cycling through preview images on hover.
 */
const PreviewImage = ({ previewUrls }: PreviewImageProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const previewDivRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const div = previewDivRef.current;
    if (!div || previewUrls.length <= 1) return;

    const handleMouseEnter = () => {
      if (intervalRef.current !== null) return; // Already cycling

      intervalRef.current = window.setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % previewUrls.length);
      }, 1000);
    };

    const handleMouseLeave = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCurrentIndex(0);
    };

    div.addEventListener('mouseenter', handleMouseEnter);
    div.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      div.removeEventListener('mouseenter', handleMouseEnter);
      div.removeEventListener('mouseleave', handleMouseLeave);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [previewUrls]);

  if (!previewUrls || previewUrls.length === 0) {
    return null;
  }

  return (
    <Box
      ref={previewDivRef}
      className="preview-image-container"
    >
      <img
        src={previewUrls[currentIndex]}
        alt="Video preview"
        className="preview-image"
        onError={(e) => {
          logger.error('Preview image failed to load');
          (e.target as HTMLImageElement).classList.add('hidden');
        }}
      />
    </Box>
  );
};

/**
 * Component for displaying a single manifest item.
 */
const ManifestItem = ({ manifest, onDownload, onClear, downloadProgress, onCancel, isCompleted }: ManifestItemProps & { isCompleted: boolean }) => {
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

/**
 * Component for displaying download progress (legacy, kept for compatibility but not used in new UI).
 */
const ProgressBar = ({ progress, onCancel }: ProgressBarProps) => {
  if (!progress) {
    return null;
  }

  // Don't show progress bar for completed or canceled downloads
  if (progress.status === 'complete' || progress.status === 'canceled') {
    return null;
  }

  const percent = Math.round((progress.downloaded / progress.total) * 100);

  let infoText = 'Starting download...';

  if (progress.status === 'creating_zip') {
    if (progress.zipSize) {
      infoText = `Created ${formatBytes(progress.zipSize)} zip file`;
    } else if (progress.totalBytes) {
      infoText = `Compressing ${formatBytes(progress.totalBytes)} into zip archive...`;
    } else {
      infoText = 'Creating ZIP file...';
    }
  } else if (progress.status === 'downloading') {
    const segments = `${progress.downloaded}/${progress.total}`.padEnd(10);
    const speed = progress.downloadSpeed && progress.downloadSpeed > 0
      ? formatSpeed(progress.downloadSpeed).padEnd(12)
      : '            ';
    const size = progress.downloadedBytes !== undefined
      ? formatBytes(progress.downloadedBytes).padEnd(12)
      : '            ';
    infoText = `Segments: ${segments} ${speed} ${size}`.trimEnd();
  }

  return (
    <Box className="manifest-item-progress-container-box">
      <Box className="manifest-item-progress-bar-container">
        <LinearProgress
          variant="determinate"
          value={percent}
          className="manifest-item-progress-bar"
        />
        <IconButton size="small" onClick={onCancel} className="manifest-item-progress-cancel-button">
          <CancelIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography variant="caption" className="manifest-item-progress-info-text">
        {infoText}
      </Typography>
    </Box>
  );
};

/**
 * Main Popup component.
 */
const ITEMS_PER_PAGE = 5;

const Popup = () => {
  const [manifests, setManifests] = useState<ManifestSummary[]>([]);
  const [downloads, setDownloads] = useState<Map<string, DownloadState>>(new Map());
  const [completedDownloads, setCompletedDownloads] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>('');
  const [statusText, setStatusText] = useState<string>('Loading extension...');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [mostRecentDomain, setMostRecentDomain] = useState<string | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Opens the side panel for ignore list management
  const openIgnoreListSidePanel = useCallback(async () => {
    try {
      const window = await chrome.windows.getCurrent();
      if (window.id !== undefined) {
        await chrome.sidePanel.open({ windowId: window.id });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error opening side panel:', errorMessage);
    }
  }, []);

  // Helper function to compare two manifest arrays for equality
  const areManifestsEqual = useCallback((oldManifests: ManifestSummary[], newManifests: ManifestSummary[]): boolean => {
    if (oldManifests.length !== newManifests.length) {
      return false;
    }

    // Compare by ID and capturedAt timestamp (quick comparison)
    for (let i = 0; i < oldManifests.length; i++) {
      const oldManifest = oldManifests[i];
      const newManifest = newManifests[i];

      if (oldManifest.id !== newManifest.id || oldManifest.capturedAt !== newManifest.capturedAt) {
        return false;
      }

      // Also check if previewUrls changed (length and first/last URLs)
      const oldPreviewUrls = oldManifest.previewUrls || [];
      const newPreviewUrls = newManifest.previewUrls || [];
      if (oldPreviewUrls.length !== newPreviewUrls.length) {
        return false;
      }
      if (oldPreviewUrls.length > 0 && (oldPreviewUrls[0] !== newPreviewUrls[0] ||
          oldPreviewUrls[oldPreviewUrls.length - 1] !== newPreviewUrls[newPreviewUrls.length - 1])) {
        return false;
      }
    }

    return true;
  }, []);

  // Update manifest status
  const updateStatus = useCallback(async () => {
    try {
      // Get the current window ID to filter manifests by window
      let windowId: number | undefined;
      try {
        const currentWindow = await chrome.windows.getCurrent();
        windowId = currentWindow.id;
      } catch (error) {
        // If we can't get the window, continue without window ID
      }

      chrome.runtime.sendMessage({ action: 'getStatus', windowId } as ExtensionMessage, (response: ExtensionResponse) => {
        if (chrome.runtime.lastError) {
          logger.error('Error getting status:', chrome.runtime.lastError);
          // Only update if current state is not already empty
          setManifests((prev) => {
            if (prev.length === 0) return prev;
            return [];
          });
          setStatusText((prev) => prev === 'Error loading manifests' ? prev : 'Error loading manifests');
          return;
        }

        if (response && 'manifestHistory' in response) {
          const statusResponse = response as GetStatusResponse;
          const newManifests = statusResponse.manifestHistory;

          // Check if manifests have actually changed before updating state
          setManifests((prevManifests) => {
            const hasChanged = !areManifestsEqual(prevManifests, newManifests);

            // Only update mostRecentDomain if manifests actually changed
            if (hasChanged && newManifests.length > 0) {
              const mostRecent = newManifests[0];
              if (mostRecent.pageDomain) {
                setMostRecentDomain(mostRecent.pageDomain);
                // Clear the flag after a short delay so it only affects the immediate sort
                setTimeout(() => setMostRecentDomain(null), 100);
              }
            }

            // Return previous reference if unchanged to prevent re-render
            return hasChanged ? newManifests : prevManifests;
          });

          // Only update status text if it changed
          const newStatusText = newManifests.length === 0
            ? 'Monitoring for video streams...'
            : `${newManifests.length} manifest${newManifests.length > 1 ? 's' : ''} captured`;
          setStatusText((prev) => prev === newStatusText ? prev : newStatusText);
        } else {
          // Only update if current state is not already empty
          setManifests((prev) => {
            if (prev.length === 0) return prev;
            return [];
          });
          setStatusText((prev) => prev === 'Monitoring for video streams...' ? prev : 'Monitoring for video streams...');
        }
      });
    } catch (error) {
      logger.error('Exception in updateStatus:', error);
      // Only update if current state is not already in error state
      setManifests((prev) => {
        if (prev.length === 0) return prev;
        return [];
      });
      setStatusText((prev) => prev === 'Error loading manifests' ? prev : 'Error loading manifests');
    }
  }, [areManifestsEqual]);

  // Download manifest
  const downloadManifest = useCallback((manifestId: string, _format: DownloadFormat = 'zip') => {
    // Prevent double-clicks - check if download already in progress for this manifest
    if (downloads.has(manifestId)) {
      const downloadState = downloads.get(manifestId);
      if (downloadState && downloadState.progress.status !== 'complete' && downloadState.progress.status !== 'canceled') {
        logger.log(`Download already in progress for manifest ${manifestId}, ignoring duplicate click`);
        return;
      }
    }

    setError('');

    // Remove from completed set when starting a new download
    setCompletedDownloads((prev) => {
      const updated = new Set(prev);
      updated.delete(manifestId);
      return updated;
    });

    // Set initial progress state for this manifest
    setDownloads((prev) => {
      const newDownloads = new Map(prev);
      newDownloads.set(manifestId, {
        downloadId: '', // Will be set when download starts
        progress: {
          downloaded: 0,
          total: 1,
          status: 'starting',
          downloadedBytes: 0,
          totalBytes: undefined,
          downloadSpeed: 0
        }
      });
      return newDownloads;
    });

    chrome.runtime.sendMessage({
      action: 'startDownload',
      manifestId: manifestId,
      format: 'zip'
    } as ExtensionMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        setError(errorMsg);
        setDownloads((prev) => {
          const newDownloads = new Map(prev);
          newDownloads.delete(manifestId);
          return newDownloads;
        });
      } else if (response && 'error' in response) {
        const errorMsg = response.error || 'Unknown error';
        setError(errorMsg);
        setDownloads((prev) => {
          const newDownloads = new Map(prev);
          newDownloads.delete(manifestId);
          return newDownloads;
        });
      }
    });
  }, [downloads]);

  // Cancel download for a specific manifest
  const cancelDownload = useCallback((manifestId: string) => {
    const downloadState = downloads.get(manifestId);
    if (downloadState && downloadState.downloadId) {
      chrome.runtime.sendMessage({
        action: 'cancelDownload',
        downloadId: downloadState.downloadId
      } as ExtensionMessage, () => {
        setDownloads((prev) => {
          const newDownloads = new Map(prev);
          newDownloads.delete(manifestId);
          return newDownloads;
        });
      });
    }
  }, [downloads]);

  // Clear manifest
  const clearManifest = useCallback((manifestId: string) => {
    chrome.runtime.sendMessage({ action: 'clearManifest', manifestId: manifestId } as ExtensionMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        setError(errorMsg);
        return;
      }
      if (response && 'success' in response) {
        updateStatus();
      }
    });
  }, [updateStatus]);

  // Cleanup downloads - cancel all active downloads and clean up storage
  const cleanupDownloads = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'cleanupDownloads'
      } as CleanupDownloadsMessage) as CleanupDownloadsResponse | { error: string };

      if ('error' in response) {
        setError(`Cleanup failed: ${response.error}`);
      } else {
        logger.log(`Cleanup complete: ${response.canceled} download(s) canceled, ${response.storageKeysCleaned} storage key(s) cleaned`);
        // Refresh status to update UI
        await updateStatus();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(`Cleanup error: ${errorMessage}`);
      logger.error('Error cleaning up downloads:', error);
    }
  }, [updateStatus]);

  // Clear all manifests
  const clearAllManifests = useCallback(() => {
    chrome.runtime.sendMessage({ action: 'clearManifest' } as ExtensionMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        setError(errorMsg);
        return;
      }
      if (response && 'success' in response) {
        updateStatus();
      }
    });
  }, [updateStatus]);

  // Group manifests by domain and sort
  const groupedManifests = useCallback(() => {
    // Get set of manifest IDs with active downloads
    const activeDownloadIds = new Set<string>();
    for (const [manifestId] of downloads.entries()) {
      activeDownloadIds.add(manifestId);
    }
    return groupManifestsByDomain(manifests, mostRecentDomain, activeDownloadIds);
  }, [manifests, mostRecentDomain, downloads]);

  // Block a domain (add to ignore list and remove manifests)
  const blockDomain = useCallback((domain: string) => {
    chrome.runtime.sendMessage({
      action: 'addToIgnoreList',
      domain: domain
    } as AddToIgnoreListMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        setError(errorMsg);
        return;
      }
      if (response && 'error' in response) {
        const errorMsg = response.error || 'Unknown error';
        setError(errorMsg);
        return;
      }
      // Success - update status to refresh the list
      updateStatus();
    });
  }, [updateStatus]);

  // Message listener
  useEffect(() => {
    const messageListener = (message: ExtensionMessage) => {
      if (message.action === 'downloadProgress') {
        const progressMessage = message as DownloadProgressMessage;

        // Update progress for the specific manifest
        setDownloads((prev) => {
          const newDownloads = new Map(prev);

          // Use manifestId from the message
          if (progressMessage.manifestId) {
            newDownloads.set(progressMessage.manifestId, {
              downloadId: progressMessage.downloadId,
              progress: {
                downloaded: progressMessage.downloaded,
                total: progressMessage.total,
                status: progressMessage.status,
                downloadedBytes: progressMessage.downloadedBytes,
                totalBytes: progressMessage.totalBytes,
                downloadSpeed: progressMessage.downloadSpeed,
                zipSize: progressMessage.zipSize
              }
            });

            // Clear progress after completion
            if (progressMessage.status === 'complete' || progressMessage.status === 'canceled') {
              if (progressMessage.status === 'complete') {
                // Mark this manifest as having completed download
                setCompletedDownloads((prev) => {
                  const updated = new Set(prev);
                  updated.add(progressMessage.manifestId);
                  return updated;
                });
              } else {
                // Remove from completed set if canceled
                setCompletedDownloads((prev) => {
                  const updated = new Set(prev);
                  updated.delete(progressMessage.manifestId);
                  return updated;
                });
              }
              setTimeout(() => {
                setDownloads((current) => {
                  const updated = new Map(current);
                  updated.delete(progressMessage.manifestId);
                  return updated;
                });
              }, 2000);
            }
          }

          return newDownloads;
        });
      } else if (message.action === 'downloadError') {
        const errorMessage = message as DownloadErrorMessage;
        setError(errorMessage.error || 'Download failed');

        // Remove the failed download - we need to find which manifest it belongs to
        setDownloads((prev) => {
          const newDownloads = new Map(prev);
          for (const [manifestId, downloadState] of prev.entries()) {
            if (downloadState.downloadId === errorMessage.downloadId) {
              newDownloads.delete(manifestId);
              break;
            }
          }
          return newDownloads;
        });
      } else if (message.action === 'manifestCaptured') {
        const capturedMessage = message as ManifestCapturedMessage;
        logger.log(`Manifest captured: ${capturedMessage.fileName}`);
        // Track the most recently captured domain to bump it to top
        // We'll get the domain from the updated status
        updateStatus();
      } else if (message.action === 'previewUpdated') {
        const previewMessage = message as PreviewUpdatedMessage;
        logger.log(`Preview updated for manifest ${previewMessage.manifestId}: ${previewMessage.previewUrls.length} frames`);

        // Update the specific manifest's preview URLs
        setManifests((prev) =>
          prev.map((m) =>
            m.id === previewMessage.manifestId
              ? { ...m, previewUrls: previewMessage.previewUrls }
              : m
          )
        );
      } else if (message.action === 'm3u8FetchError') {
        const fetchErrorMessage = message as M3U8FetchErrorMessage;
        const fileName = extractFilenameFromUrl(fetchErrorMessage.url);
        const errorMsg = `Failed to fetch ${fileName}: ${fetchErrorMessage.status} ${fetchErrorMessage.statusText || ''}`;
        logger.error(`${errorMsg}`, fetchErrorMessage.url);
        setError(errorMsg);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [updateStatus]);

  // Initial load and periodic updates
  useEffect(() => {
    // Verify chrome.runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      logger.error('CRITICAL: chrome.runtime is not available!');
      setStatusText('ERROR: Chrome runtime not available!');
      return;
    }

    // Check for ongoing downloads when popup opens
    chrome.runtime.sendMessage({ action: 'getDownloadStatus' } as ExtensionMessage, (response: ExtensionResponse) => {
      if (response && 'downloads' in response) {
        const statusResponse = response as GetDownloadStatusResponse;
        if (statusResponse.downloads && statusResponse.downloads.length > 0) {
          // Restore download states for all active downloads
          const newDownloads = new Map<string, DownloadState>();
          for (const download of statusResponse.downloads) {
            newDownloads.set(download.manifestId, {
              downloadId: download.downloadId,
              progress: download.progress
            });
          }
          setDownloads(newDownloads);
        }
      }
    });

    // Initial status update
    updateStatus();

    // Update status every 5 seconds
    statusIntervalRef.current = setInterval(updateStatus, 5000);

    return () => {
      if (statusIntervalRef.current !== null) {
        clearInterval(statusIntervalRef.current);
      }
    };
  }, [updateStatus]);

  // Group manifests by domain
  const domainGroups = groupedManifests();

  // Calculate pagination by groups (each group can contain multiple manifests)
  const totalPages = Math.ceil(domainGroups.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedGroups = domainGroups.slice(startIndex, endIndex);

  // Reset to page 1 if current page is out of bounds
  useEffect(() => {
    if (domainGroups.length > 0 && currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [domainGroups.length, totalPages, currentPage]);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const [speedDialOpen, setSpeedDialOpen] = useState(false);

  const speedDialActions = [
    ...(manifests.length > 0 ? [{
      icon: <DeleteIcon />,
      name: 'Clear All Manifests',
      onClick: clearAllManifests
    }] : []),
    ...((downloads.size > 0 || manifests.length > 0) ? [{
      icon: <CleaningServicesIcon />,
      name: 'Cleanup Downloads',
      onClick: cleanupDownloads
    }] : []),
    {
      icon: <SettingsIcon />,
      name: 'Manage Ignore List',
      onClick: openIgnoreListSidePanel
    }
  ];

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Box className="popup-container">
        <Typography variant="h6" className="popup-title">
          Stream Video Saver
        </Typography>

        <Chip
          label={statusText}
          color={manifests.length > 0 ? 'success' : 'default'}
          size="small"
          className="popup-status-chip"
        />

        <Box
          id="manifestHistory"
          className="manifest-history-container"
        >
          {manifests.length === 0 ? (
            <Typography variant="body2" color="text.secondary" className="empty-state-text">
              No manifests captured yet. Navigate to a page with video streams.
            </Typography>
          ) : (
            paginatedGroups.map((group) => (
              <Card key={group.domain} className="domain-group-card">
                <Box className="domain-group-header-box">
                  <Typography variant="subtitle2" className="domain-group-title-text">
                    {group.domain}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => blockDomain(group.domain)}
                    title={`Block ${group.domain} and remove all manifests from this domain`}
                    className="domain-group-block-button"
                  >
                    <BlockIcon fontSize="small" />
                  </IconButton>
                </Box>
                <CardContent className="domain-group-content">
                  {group.manifests.map((manifest) => (
                    <ManifestItem
                      key={manifest.id}
                      manifest={manifest}
                      onDownload={downloadManifest}
                      onClear={clearManifest}
                      downloadProgress={downloads.get(manifest.id)?.progress}
                      onCancel={cancelDownload}
                      isCompleted={completedDownloads.has(manifest.id)}
                    />
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </Box>

        {domainGroups.length > ITEMS_PER_PAGE && (
          <Box className="pagination-container">
            <Pagination
              count={totalPages}
              page={currentPage}
              onChange={(_, page) => setCurrentPage(page)}
              size="small"
              color="primary"
            />
          </Box>
        )}

        {error && (
          <Alert severity="error" className="error-alert">
            {error}
          </Alert>
        )}

        {speedDialActions.length > 0 && (
          <>
            <Box className="speed-dial-hover-zone" />
            <SpeedDial
              ariaLabel="Actions"
              className="speed-dial-container"
              icon={<SpeedDialIcon />}
              onClose={() => setSpeedDialOpen(false)}
              onOpen={() => setSpeedDialOpen(true)}
              open={speedDialOpen}
            >
              {speedDialActions.map((action) => (
                <SpeedDialAction
                  key={action.name}
                  icon={action.icon}
                  tooltipTitle={action.name}
                  onClick={() => {
                    action.onClick();
                    setSpeedDialOpen(false);
                  }}
                />
              ))}
            </SpeedDial>
          </>
        )}
      </Box>
    </ThemeProvider>
  );
};

// Initialize React app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  logger.log('DOMContentLoaded fired - initializing React app');

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    logger.error('Root element not found!');
    return;
  }

  const root = createRoot(rootElement);
  root.render(<Popup />);
});
