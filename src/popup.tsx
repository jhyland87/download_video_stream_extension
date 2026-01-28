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
    <div className="manifest-item-preview" ref={previewDivRef}>
      <img
        src={previewUrls[currentIndex]}
        alt="Video preview"
        className="manifest-preview-image"
        onError={(e) => {
          logger.error('Preview image failed to load');
          (e.target as HTMLImageElement).classList.add('hidden');
        }}
      />
    </div>
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

  return (
    <div className="manifest-item" data-manifest-id={manifest.id}>
      {manifest.previewUrls && manifest.previewUrls.length > 0 && (
        <PreviewImage previewUrls={manifest.previewUrls} />
      )}
      <div className="manifest-item-content">
        <div className="manifest-item-header">
          <span>{displayTitle}</span>
          <button
            className="btn-small secondary btn-clear-manifest"
            data-manifest-id={manifest.id}
            onClick={() => onClear(manifest.id)}
          >
            ×
          </button>
        </div>
        {formattedPageUrl && manifest.pageUrl && (
          <a
            href={manifest.pageUrl}
            className="manifest-item-page-link"
            title={manifest.pageUrl}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              chrome.tabs.create({ url: manifest.pageUrl });
            }}
          >
            {formattedPageUrl}
          </a>
        )}
        <div className="manifest-item-info">{infoText}</div>
      </div>
      <div className="manifest-item-actions">
        {downloadProgress && downloadProgress.status !== 'complete' ? (
          <div className="manifest-item-progress-container">
            <div className="manifest-item-progress-wrapper">
              <div className="manifest-item-progress-bar">
                <div
                  className={`manifest-item-progress-fill ${downloadProgress.status === 'canceled' ? 'canceled' : ''}`}
                  style={{ width: `${Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}%` }}
                >
                  {downloadProgress.status !== 'canceled' && (Math.round((downloadProgress.downloaded / downloadProgress.total) * 100) + '%')}
                </div>
                {downloadProgress.status === 'canceled' && (
                  <div className="manifest-item-progress-canceled-text">Download Canceled</div>
                )}
              </div>
              {downloadProgress.status !== 'canceled' && (
                <div className="manifest-item-progress-info">
                  {(() => {
                    let infoText = 'Starting download...';
                    if (downloadProgress.status === 'creating_zip') {
                      if (downloadProgress.zipSize) {
                        infoText = `Created ${formatBytes(downloadProgress.zipSize)} zip file`;
                      } else if (downloadProgress.totalBytes) {
                        infoText = `Compressing ${formatBytes(downloadProgress.totalBytes)} into zip archive...`;
                      } else {
                        infoText = 'Creating ZIP file...';
                      }
                    } else if (downloadProgress.status === 'downloading') {
                      const segments = `${downloadProgress.downloaded}/${downloadProgress.total}`.padEnd(10);
                      const speed = downloadProgress.downloadSpeed && downloadProgress.downloadSpeed > 0
                        ? formatSpeed(downloadProgress.downloadSpeed).padEnd(12)
                        : '            ';
                      const size = downloadProgress.downloadedBytes !== undefined
                        ? formatBytes(downloadProgress.downloadedBytes).padEnd(12)
                        : '            ';
                      infoText = `Segments: ${segments} ${speed} ${size}`.trimEnd();
                    }
                    return infoText;
                  })()}
                </div>
              )}
            </div>
            {downloadProgress.status !== 'canceled' && (
              <button
                className="button secondary btn-cancel-download"
                onClick={() => onCancel(manifest.id)}
                title="Cancel download"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <button
            className={`button ${isCompleted ? 'secondary' : 'primary'} btn-download-zip`}
            data-manifest-id={manifest.id}
            onClick={() => onDownload(manifest.id)}
          >
            {isCompleted ? 'Zip Downloaded' : 'Download ZIP'}
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Component for displaying download progress.
 */
const ProgressBar = ({ progress, onCancel }: ProgressBarProps) => {
  if (!progress) {
    return null;
  }

  // Don't show progress bar for completed or canceled downloads
  if (progress.status === 'complete' || progress.status === 'canceled') {
    return null;
  }

  // At this point, TypeScript knows status can only be 'starting' | 'downloading' | 'creating_zip'
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
    <div className="progress active">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${percent}%` }}>
          {percent}%
        </div>
      </div>
      <div className="info">{infoText}</div>
      <button
        className="button secondary cancel-download-btn"
        onClick={onCancel}
      >
        Cancel Download
      </button>
    </div>
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

  return (
    <div>
      <h1>Stream Video Saver</h1>

      <div className={`status ${manifests.length > 0 ? 'active' : ''}`}>
        {statusText}
      </div>


      <div id="manifestHistory" className="manifest-history">
        {manifests.length === 0 ? (
          <div>No manifests captured yet. Navigate to a page with video streams.</div>
        ) : (
          paginatedGroups.map((group) => (
            <div key={group.domain} className="domain-group">
              <div className="domain-group-header">
                <span className="domain-group-title">{group.domain}</span>
                <button
                  className="btn-block-domain"
                  onClick={() => blockDomain(group.domain)}
                  title={`Block ${group.domain} and remove all manifests from this domain`}
                  aria-label={`Block ${group.domain}`}
                >
                  🚫
                </button>
              </div>
              <div className="domain-group-manifests">
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
              </div>
            </div>
          ))
        )}
      </div>

      {domainGroups.length > ITEMS_PER_PAGE && (
        <div className="pagination">
          <button
            className="button secondary pagination-btn"
            onClick={handlePreviousPage}
            disabled={currentPage === 1}
          >
            Previous
          </button>
          <div className="pagination-info">
            Page {currentPage} of {totalPages}
          </div>
          <button
            className="button secondary pagination-btn"
            onClick={handleNextPage}
            disabled={currentPage === totalPages}
          >
            Next
          </button>
        </div>
      )}

      {error && (
        <div className="error show">
          Error: {error}
        </div>
      )}

      <div className="action-buttons">
        {manifests.length > 0 && (
          <button
            className="button secondary"
            onClick={clearAllManifests}
          >
            Clear All Manifests
          </button>
        )}

        {(downloads.size > 0 || manifests.length > 0) && (
          <button
            className="button secondary"
            onClick={cleanupDownloads}
            title="Cancel all active downloads and clean up stored ZIP chunks"
          >
            Cleanup Downloads
          </button>
        )}

        <button
          className="button secondary"
          onClick={openIgnoreListSidePanel}
        >
          Manage Ignore List
        </button>
      </div>
    </div>
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
