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
  AddToIgnoreListMessage
} from './types';
import { logger } from './utils/logger';

// CRITICAL: This should appear in console immediately when script loads
logger.log('popup.tsx loaded - script is executing');

/**
 * Formats bytes into a human-readable string (B, KB, MB, GB).
 * @param bytes - The number of bytes to format
 * @returns A formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Formats download speed into a human-readable string.
 * @param bytesPerSecond - The download speed in bytes per second
 * @returns A formatted string (e.g., "1.5 MB/s")
 */
function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

/**
 * Formats duration into a human-readable string (H:MM:SS or MM:SS).
 * @param durationSeconds - The duration in seconds
 * @returns A formatted string (e.g., "1:23:45" or "23:45")
 */
function formatDuration(durationSeconds: number): string {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = Math.floor(durationSeconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extracts filename from a URL.
 * @param url - The URL to extract filename from
 * @returns The filename or 'm3u8' as default
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    return pathParts[pathParts.length - 1] || 'm3u8';
  } catch (error) {
    // Fallback for invalid URLs
    const urlWithoutQuery = url.split('?')[0];
    const pathParts = urlWithoutQuery.split('/').filter(part => part.length > 0);
    return pathParts[pathParts.length - 1] || 'm3u8';
  }
}

/**
 * Formats a page URL for display: domain + last 10 characters of path (without query/hash).
 * @param url - The full URL to format
 * @returns Formatted string like "example.com/.../path" or undefined if URL is invalid
 */
function formatPageUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    // Remove query params and hash
    const pathWithoutQuery = urlObj.pathname;
    // Get last 10 characters of path (or full path if shorter)
    const lastPath = pathWithoutQuery.length > 10
      ? '...' + pathWithoutQuery.slice(-10)
      : pathWithoutQuery;

    return `${domain}${lastPath}`;
  } catch (error) {
    // Invalid URL, return undefined
    return undefined;
  }
}

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
const ManifestItem = ({ manifest, onDownload, onClear }: ManifestItemProps) => {
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
        <div className="manifest-item-actions">
          <button
            className="button primary btn-download-zip"
            data-manifest-id={manifest.id}
            onClick={() => onDownload(manifest.id)}
          >
            Download ZIP
          </button>
        </div>
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

  // Don't show progress bar for completed or cancelled downloads
  if (progress.status === 'complete' || progress.status === 'cancelled') {
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

interface DomainGroup {
  domain: string;
  manifests: ManifestSummary[];
  mostRecentCapture: string; // ISO timestamp of most recent manifest in group
}

const Popup = () => {
  const [manifests, setManifests] = useState<ManifestSummary[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string>('');
  const [statusText, setStatusText] = useState<string>('Loading extension...');
  const [activeDownloadId, setActiveDownloadId] = useState<string | null>(null);
  const [selectedManifestId, setSelectedManifestId] = useState<string | null>(null);
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
          setManifests([]);
          setStatusText('Error loading manifests');
          return;
        }

        if (response && 'manifestHistory' in response) {
          const statusResponse = response as GetStatusResponse;
          const newManifests = statusResponse.manifestHistory;
          
          // Track the most recently captured domain (first manifest is most recent)
          if (newManifests.length > 0) {
            const mostRecent = newManifests[0];
            if (mostRecent.pageDomain) {
              setMostRecentDomain(mostRecent.pageDomain);
              // Clear the flag after a short delay so it only affects the immediate sort
              setTimeout(() => setMostRecentDomain(null), 100);
            }
          }
          
          setManifests(newManifests);
          
          if (newManifests.length === 0) {
            setStatusText('Monitoring for video streams...');
          } else {
            setStatusText(`${newManifests.length} manifest${newManifests.length > 1 ? 's' : ''} captured`);
          }
        } else {
          setManifests([]);
          setStatusText('Monitoring for video streams...');
        }
      });
    } catch (error) {
      logger.error('Exception in updateStatus:', error);
      setManifests([]);
      setStatusText('Error loading manifests');
    }
  }, []);

  // Download manifest
  const downloadManifest = useCallback((manifestId: string, _format: DownloadFormat = 'zip') => {
    // Prevent double-clicks
    if (selectedManifestId === manifestId && progress && progress.status !== 'complete' && progress.status !== 'cancelled') {
      logger.log(`Download already in progress for manifest ${manifestId}, ignoring duplicate click`);
      return;
    }

    setSelectedManifestId(manifestId);
    setError('');
    setProgress({
      downloaded: 0,
      total: 1,
      status: 'downloading',
      downloadedBytes: 0,
      totalBytes: undefined,
      downloadSpeed: 0
    });

    chrome.runtime.sendMessage({
      action: 'startDownload',
      manifestId: manifestId,
      format: 'zip'
    } as ExtensionMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        setError(errorMsg);
        setProgress(null);
      } else if (response && 'error' in response) {
        const errorMsg = response.error || 'Unknown error';
        setError(errorMsg);
        setProgress(null);
      }
    });
  }, [selectedManifestId, progress]);

  // Cancel download
  const cancelDownload = useCallback(() => {
    if (activeDownloadId) {
      chrome.runtime.sendMessage({
        action: 'cancelDownload',
        downloadId: activeDownloadId
      } as ExtensionMessage, () => {
        setActiveDownloadId(null);
        setProgress(null);
      });
    }
  }, [activeDownloadId]);

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
  const groupManifestsByDomain = useCallback((manifestsList: ManifestSummary[]): DomainGroup[] => {
    // Group by domain
    const domainMap = new Map<string, ManifestSummary[]>();
    for (const manifest of manifestsList) {
      const domain = manifest.pageDomain || 'Unknown Domain';
      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain)!.push(manifest);
    }

    // Sort within each group by capturedAt (newest first)
    const groups: DomainGroup[] = [];
    for (const [domain, domainManifests] of domainMap.entries()) {
      const sorted = domainManifests.sort(
        (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()
      );
      const mostRecentCapture = sorted[0]?.capturedAt || '';
      groups.push({
        domain,
        manifests: sorted,
        mostRecentCapture
      });
    }

    // Sort groups by most recent capture (newest first)
    // If a domain was just captured, bump it to the top
    groups.sort((a, b) => {
      // If mostRecentDomain is set and matches a group, prioritize it
      if (mostRecentDomain && a.domain === mostRecentDomain) {
        return -1;
      }
      if (mostRecentDomain && b.domain === mostRecentDomain) {
        return 1;
      }
      // Otherwise sort by most recent capture
      return new Date(b.mostRecentCapture).getTime() - new Date(a.mostRecentCapture).getTime();
    });

    return groups;
  }, [mostRecentDomain]);

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
        setActiveDownloadId(progressMessage.downloadId);
        setProgress({
          downloaded: progressMessage.downloaded,
          total: progressMessage.total,
          status: progressMessage.status,
          downloadedBytes: progressMessage.downloadedBytes,
          totalBytes: progressMessage.totalBytes,
          downloadSpeed: progressMessage.downloadSpeed,
          zipSize: progressMessage.zipSize
        });

        // Clear progress after completion
        if (progressMessage.status === 'complete' || progressMessage.status === 'cancelled') {
          setTimeout(() => {
            setProgress(null);
            setActiveDownloadId(null);
          }, 2000);
        }
      } else if (message.action === 'downloadError') {
        const errorMessage = message as DownloadErrorMessage;
        setError(errorMessage.error || 'Download failed');
        setProgress(null);
        setActiveDownloadId(null);
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
          const download = statusResponse.downloads[0];
          setActiveDownloadId(download.downloadId);
          setProgress(download.progress);
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
  const domainGroups = groupManifestsByDomain(manifests);
  
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

      <ProgressBar progress={progress} onCancel={cancelDownload} />

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

      {manifests.length > 0 && (
        <button
          className="button secondary clear-all-btn"
          onClick={clearAllManifests}
        >
          Clear All Manifests
        </button>
      )}

      {error && (
        <div className="error show">
          Error: {error}
        </div>
      )}

      <button
        className="button secondary full-width"
        onClick={openIgnoreListSidePanel}
      >
        Manage Ignore List
      </button>
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
