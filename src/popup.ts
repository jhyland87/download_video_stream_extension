/**
 * @fileoverview Popup script for UI interaction and user interface management.
 * This script handles:
 * - Rendering manifest history
 * - Initiating ZIP downloads
 * - Displaying download progress
 * - Managing user interactions (clear, cancel, download)
 * - Communicating with background script
 */

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
  M3U8FetchErrorMessage
} from './types/index.js';
import {
  isHTMLElement,
  isHTMLDivElement,
  isHTMLButtonElement
} from './types/index.js';

// CRITICAL: This should appear in console immediately when script loads
console.log('[Stream Video Saver] popup.ts loaded - script is executing');

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

// Error handler to catch script loading errors
window.addEventListener('error', (e: ErrorEvent) => {
  console.error(`[Stream Video Saver] Script error: ${e.message} in ${e.filename ?? 'unknown'}:${e.lineno ?? 'unknown'}`);
  const debugInfo = document.getElementById('debugInfo');
  if (debugInfo) {
    debugInfo.textContent = 'ERROR: ' + e.message + ' in ' + (e.filename ?? 'unknown');
    debugInfo.style.color = '#d32f2f';
    debugInfo.style.background = '#ffebee';
  }
}, true);

// Try to update debug info immediately (before DOMContentLoaded)
try {
  const debugInfo = document.getElementById('debugInfo');
  if (debugInfo) {
    debugInfo.textContent = 'Debug: Script loaded! Waiting for DOM...';
    debugInfo.style.color = '#2196f3';
    console.log('[Stream Video Saver] Debug info element found and updated');
  } else {
    console.error('[Stream Video Saver] Debug info element NOT found!');
  }
} catch (error) {
  console.error('[Stream Video Saver] Error updating debug info:', error);
}

// Also try updating status immediately
try {
  const statusDiv = document.getElementById('status');
  if (statusDiv) {
    statusDiv.textContent = 'Script loaded - initializing...';
    console.log('[Stream Video Saver] Status div found and updated');
  } else {
    console.error('[Stream Video Saver] Status div NOT found!');
  }
} catch (error) {
  console.error('[Stream Video Saver] Error updating status:', error);
}

// Interval ID for periodic status updates
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let statusInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initializes the popup when DOM is ready.
 * Sets up event listeners, renders manifest history, and checks for ongoing downloads.
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Stream Video Saver] DOMContentLoaded fired');

  // Immediate test - update status div to show script is running
  const statusDiv = document.getElementById('status');
  const debugInfo = document.getElementById('debugInfo');

  if (statusDiv) {
    statusDiv.textContent = 'Popup script loaded - checking for manifests...';
    statusDiv.className = 'status';
  }

  if (debugInfo) {
    debugInfo.style.display = 'block';
    debugInfo.textContent = 'Debug: DOMContentLoaded fired, initializing...';
    debugInfo.style.color = '#2196f3';
  }

  const manifestHistoryDiv = document.getElementById('manifestHistory');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const progressDiv = document.getElementById('progress');
  const progressFill = document.getElementById('progressFill');
  const progressInfo = document.getElementById('progressInfo');
  const errorDiv = document.getElementById('error');
  const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');

  console.log('[Stream Video Saver] DOM elements found:', {
    statusDiv: !!statusDiv,
    manifestHistoryDiv: !!manifestHistoryDiv,
    clearAllBtn: !!clearAllBtn,
    progressDiv: !!progressDiv,
    progressFill: !!progressFill,
    progressInfo: !!progressInfo,
    errorDiv: !!errorDiv
  });

  if (!statusDiv || !manifestHistoryDiv) {
    console.error('[Stream Video Saver] CRITICAL: Required DOM elements not found!');
    if (statusDiv) {
      statusDiv.textContent = 'ERROR: DOM elements not found!';
      statusDiv.style.background = '#ffebee';
      statusDiv.style.color = '#c62828';
    }
    return;
  }

  let selectedManifestId: string | null = null;
  let eventListenerAttached = false;
  let activeDownloadId: string | null = null; // Track active download ID

  // Attach event listeners using event delegation (only once)
  if (!eventListenerAttached) {
    manifestHistoryDiv.addEventListener('click', (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const manifestId = target.getAttribute('data-manifest-id');
      if (!manifestId) {
        return;
      }

      if (target.classList.contains('btn-clear-manifest')) {
        clearManifest(manifestId);
      } else if (target.classList.contains('btn-download-zip')) {
        downloadManifest(manifestId, 'zip');
      }
    });
    eventListenerAttached = true;
  }

  // Cancel button click handler
  if (cancelDownloadBtn) {
    cancelDownloadBtn.addEventListener('click', () => {
      cancelDownload();
    });
  }

  /**
   * Renders the list of captured manifests in the UI.
   * Displays manifest information including filename, segment count, and capture time.
   * Shows empty state if no manifests are available.
   */
  function renderManifestHistory(manifests: ManifestSummary[]): void {
    console.log(`[Stream Video Saver] renderManifestHistory called with ${manifests?.length ?? 0} manifests`);

    if (!manifestHistoryDiv || !statusDiv || !clearAllBtn) {
      console.error('[Stream Video Saver] DOM elements not found!');
      return;
    }

    if (!manifests || manifests.length === 0) {
      manifestHistoryDiv.innerHTML = '';
      statusDiv.textContent = 'Monitoring for video streams...';
      statusDiv.className = 'status';
      clearAllBtn.style.display = 'none';
      console.log('[Stream Video Saver] Rendered empty state');
      return;
    }

    statusDiv.textContent = `${manifests.length} manifest${manifests.length > 1 ? 's' : ''} captured`;
    statusDiv.className = 'status active';
    clearAllBtn.style.display = 'block';

    const html = manifests.map((manifest) => {
      const date = new Date(manifest.capturedAt);
      const timeStr = date.toLocaleTimeString();

      // Escape HTML to prevent XSS
      const escapeHtml = (text: string): string => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };

      // Use title if available, otherwise fall back to fileName
      const displayTitle = manifest.title || manifest.fileName;

      // Format resolution and duration for display
      let infoParts: string[] = [];

      if (manifest.resolution) {
        infoParts.push(`${manifest.resolution.width}×${manifest.resolution.height}`);
      }

      if (manifest.duration) {
        const hours = Math.floor(manifest.duration / 3600);
        const minutes = Math.floor((manifest.duration % 3600) / 60);
        const seconds = Math.floor(manifest.duration % 60);

        let durationStr = '';
        if (hours > 0) {
          durationStr = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
          durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        infoParts.push(durationStr);
      }

      infoParts.push(`${manifest.segmentCount} segments`);
      infoParts.push(`Captured at ${escapeHtml(timeStr)}`);

      const infoText = infoParts.join(' • ');

      // Generate preview image HTML if available
      const hasPreview = !!manifest.previewUrls && manifest.previewUrls.length > 0;
      console.log(`[Stream Video Saver] Rendering manifest ${manifest.id}: hasPreview=${hasPreview}, previewUrls count=${manifest.previewUrls?.length || 0}`);
      const previewHtml = hasPreview && manifest.previewUrls
        ? `<div class="manifest-item-preview" data-preview-urls='${escapeHtml(JSON.stringify(manifest.previewUrls))}'>
             <img src="${escapeHtml(manifest.previewUrls[0])}" alt="Video preview" class="manifest-preview-image" data-current-index="0" onerror="console.error('[Stream Video Saver] Preview image failed to load for manifest ${escapeHtml(manifest.id)}')" />
           </div>`
        : '';

      return `
        <div class="manifest-item" data-manifest-id="${escapeHtml(manifest.id)}">
          ${previewHtml}
          <div class="manifest-item-content">
            <div class="manifest-item-header">
              <span>${escapeHtml(displayTitle)}</span>
              <button class="btn-small secondary btn-clear-manifest" data-manifest-id="${escapeHtml(manifest.id)}" style="padding: 2px 6px; font-size: 10px;">×</button>
            </div>
            <div class="manifest-item-info">
              ${infoText}
            </div>
            <div class="manifest-item-actions">
              <button class="button primary btn-download-zip" data-manifest-id="${escapeHtml(manifest.id)}" style="font-size: 11px; padding: 6px;">Download ZIP</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    manifestHistoryDiv.innerHTML = html;
    console.log(`[Stream Video Saver] Rendered ${manifests.length} manifest items`);

    // Attach hover event listeners to all preview images for frame cycling
    const previewImages = manifestHistoryDiv.querySelectorAll('.manifest-preview-image') as NodeListOf<HTMLImageElement>;
    previewImages.forEach((img) => {
      const previewDiv = img.closest('.manifest-item-preview') as HTMLElement;
      if (!previewDiv) return;

      const previewUrlsJson = previewDiv.getAttribute('data-preview-urls');
      if (!previewUrlsJson) return;

      try {
        const previewUrls: string[] = JSON.parse(previewUrlsJson);
        attachPreviewHoverListeners(previewDiv, img, previewUrls);
      } catch (error) {
        console.error('[Stream Video Saver] Error parsing preview URLs for hover cycling:', error);
      }
    });
  }

  /**
   * Attaches hover event listeners to a preview image for frame cycling.
   * @param previewDiv - The preview container div
   * @param img - The preview image element
   * @param previewUrls - Array of preview image URLs to cycle through
   */
  function attachPreviewHoverListeners(previewDiv: HTMLElement, img: HTMLImageElement, previewUrls: string[]): void {
    if (!Array.isArray(previewUrls) || previewUrls.length <= 1) return;

    let currentIndex = 0;
    let hoverInterval: number | null = null;

    // Start cycling on hover
    previewDiv.addEventListener('mouseenter', () => {
      if (hoverInterval !== null) return; // Already cycling

      const cycleFrames = (): void => {
        currentIndex = (currentIndex + 1) % previewUrls.length;
        img.src = previewUrls[currentIndex];
        img.setAttribute('data-current-index', currentIndex.toString());
      };

      // Cycle every 1 second
      hoverInterval = window.setInterval(cycleFrames, 1000);
    });

    // Stop cycling on mouse leave
    previewDiv.addEventListener('mouseleave', () => {
      if (hoverInterval !== null) {
        clearInterval(hoverInterval);
        hoverInterval = null;
      }
      // Reset to first frame
      currentIndex = 0;
      img.src = previewUrls[0];
      img.setAttribute('data-current-index', '0');
    });
  }

  /**
   * Updates the manifest status by requesting current state from background script.
   * Fetches manifest history and re-renders the UI.
   */
  function updateStatus(): void {
    console.log('[Stream Video Saver] updateStatus() called - sending getStatus message');

    try {
      chrome.runtime.sendMessage({ action: 'getStatus' } as ExtensionMessage, (response: ExtensionResponse) => {
        console.log('[Stream Video Saver] getStatus callback invoked');
        console.log(`[Stream Video Saver] chrome.runtime.lastError: ${chrome.runtime.lastError?.message ?? 'none'}`);
        console.log(`[Stream Video Saver] response:`, response);

        if (chrome.runtime.lastError) {
          console.error('[Stream Video Saver] Error getting status:', chrome.runtime.lastError);
          renderManifestHistory([]);
          return;
        }

        if (response && 'manifestHistory' in response) {
          const statusResponse = response as GetStatusResponse;
          console.log(`[Stream Video Saver] Rendering ${statusResponse.manifestHistory.length} manifests`);
          console.log(`[Stream Video Saver] Manifest data:`, statusResponse.manifestHistory);
          renderManifestHistory(statusResponse.manifestHistory);
        } else {
          console.log('[Stream Video Saver] No manifests in response, rendering empty list');
          console.log('[Stream Video Saver] Full response object:', response);
          renderManifestHistory([]);
        }
      });
    } catch (error) {
      console.error('[Stream Video Saver] Exception in updateStatus:', error);
      renderManifestHistory([]);
    }
  }

  /**
   * Initiates download of a specific manifest as a ZIP file.
   * Sends request to background script for background download.
   */
  async function downloadManifest(manifestId: string, _format: DownloadFormat): Promise<void> {
    if (!isHTMLDivElement(progressDiv) || !isHTMLElement(progressFill) || !isHTMLElement(progressInfo) || !isHTMLDivElement(errorDiv)) {
      console.error('[Stream Video Saver] Required DOM elements not found');
      return;
    }

    // Prevent double-clicks
    if (selectedManifestId === manifestId && progressDiv.classList.contains('active')) {
      console.log(`[Stream Video Saver] Download already in progress for manifest ${manifestId}, ignoring duplicate click`);
      return;
    }

    selectedManifestId = manifestId;
    // Clear any previous error messages when starting a new download
    errorDiv.classList.remove('show');
    errorDiv.textContent = '';
    progressDiv.classList.add('active');
    progressFill.style.width = '0%';
    progressFill.textContent = '0%';
    progressInfo.textContent = 'Starting download...';
    if (isHTMLButtonElement(cancelDownloadBtn)) {
      cancelDownloadBtn.style.display = 'block';
    }

    // Send download request to background script
    chrome.runtime.sendMessage({
      action: 'startDownload',
      manifestId: manifestId,
      format: 'zip'
    } as ExtensionMessage, (response: ExtensionResponse) => {
      if (!isHTMLDivElement(progressDiv)) return;
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        showError(errorMsg);
        progressDiv.classList.remove('active');
        if (isHTMLButtonElement(cancelDownloadBtn)) {
          cancelDownloadBtn.style.display = 'none';
        }
      } else if (response && 'error' in response) {
        const errorMsg = response.error || 'Unknown error';
        showError(errorMsg);
        progressDiv.classList.remove('active');
        if (isHTMLButtonElement(cancelDownloadBtn)) {
          cancelDownloadBtn.style.display = 'none';
        }
      }
      // Download will continue in background, progress updates will come via messages
    });
  }

  /**
   * Cancels the currently active download.
   * Sends cancel request to background script and updates UI.
   */
  function cancelDownload(): void {
    if (!isHTMLDivElement(progressDiv) || !isHTMLElement(progressInfo)) return;
    if (activeDownloadId) {
      chrome.runtime.sendMessage({
        action: 'cancelDownload',
        downloadId: activeDownloadId
      } as ExtensionMessage, () => {
        activeDownloadId = null;
        progressDiv.classList.remove('active');
        progressInfo.textContent = 'Download cancelled';
        if (isHTMLButtonElement(cancelDownloadBtn)) {
          cancelDownloadBtn.style.display = 'none';
        }
      });
    }
  }

  /**
   * Clears a specific manifest from the history.
   * Sends clear request to background script and refreshes the UI.
   */
  function clearManifest(manifestId: string): void {
    chrome.runtime.sendMessage({ action: 'clearManifest', manifestId: manifestId } as ExtensionMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        showError(errorMsg);
        return;
      }
      if (response && 'success' in response) {
        updateStatus();
      }
    });
  }

  // Clear all manifests
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'clearManifest' } as ExtensionMessage, (response: ExtensionResponse) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        showError(errorMsg);
          return;
        }
        if (response && 'success' in response) {
          updateStatus();
        }
      });
    });
  }


  /**
   * Message listener for receiving updates from background script.
   * Handles download progress updates, download errors, and manifest capture notifications.
   */
  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.action === 'downloadProgress') {
      const progressMessage = message as DownloadProgressMessage;
      activeDownloadId = progressMessage.downloadId;
      const percent = Math.round((progressMessage.downloaded / progressMessage.total) * 100);
      if (isHTMLElement(progressFill)) {
        progressFill.style.width = percent + '%';
        progressFill.textContent = `${percent}%`;
      }

      if (progressMessage.status === 'creating_zip') {
        if (isHTMLElement(progressInfo)) {
          let text = 'Creating ZIP file...';
          // If zipSize is available, the zip file has been created
          if (progressMessage.zipSize) {
            text = `Created ${formatBytes(progressMessage.zipSize)} zip file`;
          } else if (progressMessage.totalBytes) {
            // Show uncompressed size while zipping is in progress
            text = `Compressing ${formatBytes(progressMessage.totalBytes)} into zip archive...`;
          }
          progressInfo.textContent = text;
        }
      } else if (progressMessage.status === 'complete') {
        if (isHTMLElement(progressInfo)) {
          let text = 'Download complete!';
          if (progressMessage.totalBytes) {
            text += ` • ${formatBytes(progressMessage.totalBytes)}`;
          }
          if (progressMessage.zipSize) {
            text += ` • ZIP: ${formatBytes(progressMessage.zipSize)}`;
          }
          progressInfo.textContent = text;
        }
        if (isHTMLDivElement(progressDiv)) {
          setTimeout(() => {
            progressDiv.classList.remove('active');
            activeDownloadId = null;
          }, 2000);
        }
      } else if (progressMessage.status === 'cancelled') {
        if (isHTMLElement(progressInfo)) {
          progressInfo.textContent = 'Download cancelled';
        }
        if (isHTMLDivElement(progressDiv)) {
          setTimeout(() => {
            progressDiv.classList.remove('active');
            activeDownloadId = null;
          }, 2000);
        }
      } else {
        // Status is 'downloading' - show segment progress and total downloaded size
        // Format: "Segments: {current}/{total} {speed} {Size}"
        // Use fixed-width format to prevent resizing as values change
        if (isHTMLElement(progressInfo)) {
          const segments = `${progressMessage.downloaded}/${progressMessage.total}`.padEnd(10);
          const speed = progressMessage.downloadSpeed && progressMessage.downloadSpeed > 0
            ? formatSpeed(progressMessage.downloadSpeed).padEnd(12)
            : '            '; // 12 spaces as placeholder
          const size = progressMessage.downloadedBytes !== undefined
            ? formatBytes(progressMessage.downloadedBytes).padEnd(12)
            : '            '; // 12 spaces as placeholder

          const text = `Segments: ${segments} ${speed} ${size}`.trimEnd();
          progressInfo.textContent = text;
        }
      }
      if (isHTMLDivElement(progressDiv)) {
        progressDiv.classList.add('active');
      }
      // Show cancel button when download is active
      if (isHTMLButtonElement(cancelDownloadBtn)) {
        if (progressMessage.status !== 'complete' && progressMessage.status !== 'cancelled') {
          cancelDownloadBtn.style.display = 'block';
        } else {
          cancelDownloadBtn.style.display = 'none';
        }
      }
    } else if (message.action === 'downloadError') {
      const errorMessage = message as DownloadErrorMessage;
      showError(errorMessage.error || 'Download failed');
      if (isHTMLDivElement(progressDiv)) {
        progressDiv.classList.remove('active');
      }
      activeDownloadId = null;
    } else if (message.action === 'manifestCaptured') {
      // New manifest detected
      const capturedMessage = message as ManifestCapturedMessage;
      console.log(`[Stream Video Saver] Manifest captured: ${capturedMessage.fileName}`);
      updateStatus();
    } else if (message.action === 'previewUpdated') {
      // Preview frames are ready - update the specific manifest item
      const previewMessage = message as PreviewUpdatedMessage;
      console.log(`[Stream Video Saver] Preview updated for manifest ${previewMessage.manifestId}: ${previewMessage.previewUrls.length} frames`);
      
      // Update the specific manifest item's preview in the UI
      const manifestItem = document.querySelector(`[data-manifest-id="${previewMessage.manifestId}"]`) as HTMLElement;
      if (manifestItem && previewMessage.previewUrls.length > 0) {
        let previewDiv = manifestItem.querySelector('.manifest-item-preview') as HTMLElement;
        let previewImg = manifestItem.querySelector('.manifest-preview-image') as HTMLImageElement;
        
        if (!previewDiv) {
          // Create preview div and img if they don't exist
          previewDiv = document.createElement('div');
          previewDiv.className = 'manifest-item-preview';
          previewImg = document.createElement('img');
          previewImg.className = 'manifest-preview-image';
          previewImg.alt = 'Video preview';
          previewDiv.appendChild(previewImg);
          
          // Insert preview before manifest-item-content
          const contentDiv = manifestItem.querySelector('.manifest-item-content');
          if (contentDiv) {
            manifestItem.insertBefore(previewDiv, contentDiv);
          } else {
            manifestItem.appendChild(previewDiv);
          }
        }
        
        if (previewDiv && previewImg) {
          // Update preview HTML with the new frames
          previewDiv.setAttribute('data-preview-urls', JSON.stringify(previewMessage.previewUrls));
          previewImg.src = previewMessage.previewUrls[0];
          previewImg.setAttribute('data-current-index', '0');
          
          // Remove old listeners and re-attach hover event listeners for cycling
          const newPreviewDiv = previewDiv.cloneNode(true) as HTMLElement;
          previewDiv.parentNode?.replaceChild(newPreviewDiv, previewDiv);
          const newPreviewImg = newPreviewDiv.querySelector('.manifest-preview-image') as HTMLImageElement;
          if (newPreviewImg) {
            attachPreviewHoverListeners(newPreviewDiv, newPreviewImg, previewMessage.previewUrls);
          }
        }
      } else if (!manifestItem) {
        // Manifest item not found - refresh the whole list
        console.log(`[Stream Video Saver] Manifest item ${previewMessage.manifestId} not found in DOM, refreshing list`);
        updateStatus();
      }
    } else if (message.action === 'm3u8FetchError') {
      // M3U8 fetch failed - show error to user
      const fetchErrorMessage = message as M3U8FetchErrorMessage;
      const fileName = extractFilenameFromUrl(fetchErrorMessage.url);
      const errorMsg = `Failed to fetch ${fileName}: ${fetchErrorMessage.status} ${fetchErrorMessage.statusText || ''}`;
      console.error(`[Stream Video Saver] ${errorMsg}`, fetchErrorMessage.url);
      showError(errorMsg);
    }
  });

  /**
   * Displays an error message in the UI.
   */
  function showError(message: string): void {
    if (isHTMLDivElement(errorDiv)) {
      errorDiv.textContent = 'Error: ' + message;
      errorDiv.classList.add('show');
    }
  }

  // parseM3U8 function removed - no longer needed since MP4 conversion is removed

  // Verify chrome.runtime is available
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('[Stream Video Saver] CRITICAL: chrome.runtime is not available!');
    if (statusDiv) {
      statusDiv.textContent = 'ERROR: Chrome runtime not available!';
      statusDiv.style.background = '#ffebee';
      statusDiv.style.color = '#c62828';
    }
    return;
  }

  // Test: Try to get status immediately to verify communication works
  console.log('[Stream Video Saver] Testing message passing...');
  console.log('[Stream Video Saver] chrome.runtime available:', !!chrome.runtime);
  console.log('[Stream Video Saver] chrome.runtime.sendMessage available:', typeof chrome.runtime.sendMessage === 'function');

  chrome.runtime.sendMessage({ action: 'getStatus' } as ExtensionMessage, (response: ExtensionResponse) => {
    console.log('[Stream Video Saver] TEST - Response received:', response);
    console.log('[Stream Video Saver] TEST - Last error:', chrome.runtime.lastError);
    if (chrome.runtime.lastError) {
      console.error('[Stream Video Saver] TEST - Error:', chrome.runtime.lastError.message);
      if (statusDiv) {
        statusDiv.textContent = 'ERROR: ' + chrome.runtime.lastError.message;
        statusDiv.style.background = '#ffebee';
        statusDiv.style.color = '#c62828';
      }
      return;
    }
    if (response && 'manifestHistory' in response) {
      const statusResponse = response as GetStatusResponse;
      console.log(`[Stream Video Saver] TEST - Found ${statusResponse.manifestHistory.length} manifests`);
      if (debugInfo) {
        debugInfo.textContent = `Debug: Found ${statusResponse.manifestHistory.length} manifests in response`;
        debugInfo.style.color = '#4caf50';
      }
      renderManifestHistory(statusResponse.manifestHistory);
    } else {
      console.log('[Stream Video Saver] TEST - No manifests or invalid response');
      if (debugInfo) {
        debugInfo.textContent = 'Debug: No manifests in response: ' + JSON.stringify(response);
        debugInfo.style.color = '#ff9800';
      }
      if (statusDiv) {
        statusDiv.textContent = 'No manifests found';
      }
    }
  });

  // Check for ongoing downloads when popup opens
  chrome.runtime.sendMessage({ action: 'getDownloadStatus' } as ExtensionMessage, (response: ExtensionResponse) => {
    if (response && 'downloads' in response) {
      const statusResponse = response as GetDownloadStatusResponse;
      if (statusResponse.downloads && statusResponse.downloads.length > 0) {
        const download = statusResponse.downloads[0]; // Show first active download
        activeDownloadId = download.downloadId;
        if (isHTMLDivElement(progressDiv) && isHTMLElement(progressFill)) {
          progressDiv.classList.add('active');
          const percent = Math.round((download.progress.downloaded / download.progress.total) * 100);
          progressFill.style.width = percent + '%';
          progressFill.textContent = `${percent}%`;
        }
        if (isHTMLElement(progressInfo)) {
          if (download.progress.status === 'creating_zip') {
            let text = 'Creating ZIP file...';
            // If zipSize is available, the zip file has been created
            if (download.progress.zipSize) {
              text = `Created ${formatBytes(download.progress.zipSize)} zip file`;
            } else if (download.progress.totalBytes) {
              // Show uncompressed size while zipping is in progress
              text = `Compressing ${formatBytes(download.progress.totalBytes)} into zip archive...`;
            }
            progressInfo.textContent = text;
          } else if (download.progress.status === 'complete') {
            let text = 'Download complete!';
            if (download.progress.totalBytes) {
              text += ` • ${formatBytes(download.progress.totalBytes)}`;
            }
            if (download.progress.zipSize) {
              text += ` • ZIP: ${formatBytes(download.progress.zipSize)}`;
            }
            progressInfo.textContent = text;
          } else {
            // Status is 'downloading' - show segment progress and total downloaded size
            // Format: "Segments: {current}/{total} {speed} {Size}"
            // Use fixed-width format to prevent resizing as values change
            const segments = `${download.progress.downloaded}/${download.progress.total}`.padEnd(10);
            const speed = download.progress.downloadSpeed && download.progress.downloadSpeed > 0
              ? formatSpeed(download.progress.downloadSpeed).padEnd(12)
              : '            '; // 12 spaces as placeholder
            const size = download.progress.downloadedBytes !== undefined
              ? formatBytes(download.progress.downloadedBytes).padEnd(12)
              : '            '; // 12 spaces as placeholder

            const text = `Segments: ${segments} ${speed} ${size}`.trimEnd();
            progressInfo.textContent = text;
          }
        }
        if (isHTMLButtonElement(cancelDownloadBtn) && download.progress.status !== 'complete' && download.progress.status !== 'cancelled') {
          cancelDownloadBtn.style.display = 'block';
        }
      }
    }
  });

  // Initial status update
  console.log('[Stream Video Saver] Calling initial updateStatus()');
  updateStatus();
  // Update status every 5 seconds to check for new manifests (reduced frequency to avoid excessive updates)
  console.log('[Stream Video Saver] Setting up interval to update status every 5 seconds');
  statusInterval = setInterval(updateStatus, 5000);
  console.log('[Stream Video Saver] Popup initialization complete');
});

