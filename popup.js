/**
 * @fileoverview Popup script for UI interaction and user interface management.
 * This script handles:
 * - Rendering manifest history
 * - Initiating downloads (ZIP and MP4)
 * - Displaying download progress
 * - Managing user interactions (clear, cancel, download)
 * - Communicating with background script
 */

// CRITICAL: This should appear in console immediately when script loads
console.log('[Stream Video Saver] popup.js loaded - script is executing');

// Error handler to catch script loading errors
window.addEventListener('error', function(e) {
  console.error(`[Stream Video Saver] Script error: ${e.message} in ${e.filename}:${e.lineno}`);
  const debugInfo = document.getElementById('debugInfo');
  if (debugInfo) {
    debugInfo.textContent = 'ERROR: ' + e.message + ' in ' + (e.filename || 'unknown');
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

/**
 * Interval ID for periodic status updates.
 * @type {number|null}
 */
let statusInterval = null;

/**
 * Initializes the popup when DOM is ready.
 * Sets up event listeners, renders manifest history, and checks for ongoing downloads.
 * @listens DOMContentLoaded
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

  let selectedManifestId = null;
  let eventListenerAttached = false;
  let activeDownloadId = null; // Track active download ID

  // Attach event listeners using event delegation (only once)
  if (!eventListenerAttached) {
    manifestHistoryDiv.addEventListener('click', (e) => {
      const manifestId = e.target.getAttribute('data-manifest-id');
      if (!manifestId) return;

      if (e.target.classList.contains('btn-clear-manifest')) {
        clearManifest(manifestId);
      } else if (e.target.classList.contains('btn-download-zip')) {
        downloadManifest(manifestId, 'zip');
      } else if (e.target.classList.contains('btn-download-mp4')) {
        downloadManifest(manifestId, 'mp4');
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
   * @param {Array<Object>} manifests - Array of manifest objects to display
   * @param {string} manifests[].id - Unique manifest identifier
   * @param {string} manifests[].fileName - Name of the m3u8 file
   * @param {number} manifests[].segmentCount - Number of segments in the manifest
   * @param {string} manifests[].capturedAt - ISO timestamp when manifest was captured
   * @returns {void}
   */
  function renderManifestHistory(manifests) {
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

    const html = manifests.map(manifest => {
      const date = new Date(manifest.capturedAt);
      const timeStr = date.toLocaleTimeString();

      return `
        <div class="manifest-item" data-manifest-id="${manifest.id}">
          <div class="manifest-item-header">
            <span>${manifest.fileName}</span>
            <button class="btn-small secondary btn-clear-manifest" data-manifest-id="${manifest.id}" style="padding: 2px 6px; font-size: 10px;">×</button>
          </div>
          <div class="manifest-item-name">${manifest.fileName}</div>
          <div class="manifest-item-info">
            ${manifest.segmentCount} segments • Captured at ${timeStr}
          </div>
          <div class="manifest-item-actions">
            <button class="button primary btn-download-zip" data-manifest-id="${manifest.id}" style="font-size: 11px; padding: 6px;">Download ZIP</button>
            <button class="button primary btn-download-mp4" data-manifest-id="${manifest.id}" style="font-size: 11px; padding: 6px;">Download MP4</button>
          </div>
        </div>
      `;
    }).join('');

    manifestHistoryDiv.innerHTML = html;
    console.log(`[Stream Video Saver] Rendered ${manifests.length} manifest items`);
  }

  /**
   * Updates the manifest status by requesting current state from background script.
   * Fetches manifest history and re-renders the UI.
   * @returns {void}
   */
  function updateStatus() {
    console.log('[Stream Video Saver] updateStatus() called - sending getStatus message');

    try {
      chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
        console.log('[Stream Video Saver] getStatus callback invoked');
        console.log(`[Stream Video Saver] chrome.runtime.lastError: ${chrome.runtime.lastError?.message ?? 'none'}`);
        console.log(`[Stream Video Saver] response:`, response);

        if (chrome.runtime.lastError) {
          console.error('[Stream Video Saver] Error getting status:', chrome.runtime.lastError);
          renderManifestHistory([]);
          return;
        }

        if (response && response.manifestHistory) {
          console.log(`[Stream Video Saver] Rendering ${response.manifestHistory.length} manifests`);
          console.log(`[Stream Video Saver] Manifest data:`, response.manifestHistory);
          renderManifestHistory(response.manifestHistory);
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
   * Initiates download of a specific manifest in the requested format.
   * For ZIP format: sends request to background script for background download.
   * For MP4 format: downloads and converts in popup (due to SharedArrayBuffer limitations).
   * @param {string} manifestId - The ID of the manifest to download
   * @param {string} format - The download format ('zip' or 'mp4')
   * @returns {Promise<void>}
   */
  async function downloadManifest(manifestId, format) {
    // Prevent double-clicks
    if (selectedManifestId === manifestId && progressDiv.classList.contains('active')) {
      console.log(`[Stream Video Saver] Download already in progress for manifest ${manifestId}, ignoring duplicate click`);
      return;
    }

    selectedManifestId = manifestId;
    errorDiv.classList.remove('show');
    progressDiv.classList.add('active');
    progressFill.style.width = '0%';
    progressFill.textContent = '0%';
    progressInfo.textContent = 'Starting download...';
    if (cancelDownloadBtn) {
      cancelDownloadBtn.style.display = 'block';
    }

    try {
      if (format === 'zip') {
        // Send download request to background script
        chrome.runtime.sendMessage({
          action: 'startDownload',
          manifestId: manifestId,
          format: 'zip'
        }, (response) => {
          if (chrome.runtime.lastError) {
            showError(chrome.runtime.lastError.message);
            progressDiv.classList.remove('active');
            if (cancelDownloadBtn) {
              cancelDownloadBtn.style.display = 'none';
            }
          } else if (response && response.error) {
            showError(response.error);
            progressDiv.classList.remove('active');
            if (cancelDownloadBtn) {
              cancelDownloadBtn.style.display = 'none';
            }
          }
          // Download will continue in background, progress updates will come via messages
        });
      } else if (format === 'mp4') {
        // MP4 still needs to be done in popup due to SharedArrayBuffer limitations
        const data = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'getManifestData', manifestId: manifestId }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          });
        });

        if (!data.m3u8Url || !data.m3u8Content) {
          throw new Error('Manifest data not available');
        }

        await downloadAsMp4(data);
      }
    } catch (error) {
      console.error('[Stream Video Saver] Download error:', error);
      showError(error.message || 'Download failed');
      progressDiv.classList.remove('active');
    }
  };

  /**
   * Cancels the currently active download.
   * Sends cancel request to background script and updates UI.
   * @returns {void}
   */
  function cancelDownload() {
    if (activeDownloadId) {
      chrome.runtime.sendMessage({
        action: 'cancelDownload',
        downloadId: activeDownloadId
      }, () => {
        activeDownloadId = null;
        progressDiv.classList.remove('active');
        progressInfo.textContent = 'Download cancelled';
        if (cancelDownloadBtn) {
          cancelDownloadBtn.style.display = 'none';
        }
      });
    }
  }

  /**
   * Clears a specific manifest from the history.
   * Sends clear request to background script and refreshes the UI.
   * @param {string} manifestId - The ID of the manifest to clear
   * @returns {void}
   */
  function clearManifest(manifestId) {
    chrome.runtime.sendMessage({ action: 'clearManifest', manifestId: manifestId }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }
      if (response && response.success) {
        updateStatus();
      }
    });
  };

  // Clear all manifests
  clearAllBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearManifest' }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }
      if (response && response.success) {
        updateStatus();
      }
    });
  });

  /**
   * Downloads video segments and converts them to MP4 using FFmpeg.wasm.
   * Must run in popup context due to SharedArrayBuffer requirements.
   * Downloads segments, writes to FFmpeg filesystem, concatenates, and converts to MP4.
   * @param {Object} data - Manifest data object
   * @param {string} data.m3u8Url - URL of the m3u8 file
   * @param {string} data.m3u8Content - Content of the m3u8 file
   * @param {string} data.m3u8FileName - Filename of the m3u8 file
   * @returns {Promise<void>}
   * @throws {Error} If SharedArrayBuffer is unavailable, FFmpeg fails to load, or conversion fails
   */
  async function downloadAsMp4(data) {
    // Check for SharedArrayBuffer support first
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('MP4 conversion is not available in Chrome extensions due to SharedArrayBuffer limitations. Please use the ZIP download option and convert with ffmpeg locally using: ffmpeg -i "manifest.m3u8" -c copy output.mp4');
    }

    // Wait for FFmpeg to be available
    let retries = 20;
    while (typeof window.FFmpegWASM === 'undefined' && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
      retries--;
    }

    if (typeof window.FFmpegWASM === 'undefined') {
      throw new Error('FFmpeg library not loaded. Please reload the extension.');
    }

    const { FFmpeg } = window.FFmpegWASM;
    const ffmpeg = new FFmpeg();

    // Set up logging
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      const percent = Math.round(progress * 100);
      progressFill.style.width = percent + '%';
      progressFill.textContent = `${percent}%`;
      progressInfo.textContent = `Converting to MP4... ${percent}%`;
    });

    // Load FFmpeg core from local files
    progressInfo.textContent = 'Loading FFmpeg core (this may take a moment)...';

    const coreJsUrl = chrome.runtime.getURL('ffmpeg-core/ffmpeg-core.js');
    const coreWasmUrl = chrome.runtime.getURL('ffmpeg-core/ffmpeg-core.wasm');

    // Verify files are accessible
    try {
      progressInfo.textContent = 'Verifying FFmpeg core files...';
      const jsResponse = await fetch(coreJsUrl);
      if (!jsResponse.ok) {
        throw new Error(`Cannot access FFmpeg core JS file: ${jsResponse.status}`);
      }

      const wasmResponse = await fetch(coreWasmUrl);
      if (!wasmResponse.ok) {
        throw new Error(`Cannot access FFmpeg core WASM file: ${wasmResponse.status}`);
      }
    } catch (error) {
      throw new Error(`Cannot access FFmpeg core files: ${error.message}. Make sure the extension is reloaded.`);
    }

    // Show animated status updates while loading
    let loadingDots = 0;
    let elapsedSeconds = 0;
    const loadingInterval = setInterval(() => {
      loadingDots = (loadingDots + 1) % 4;
      elapsedSeconds += 0.5;
      const dots = '.'.repeat(loadingDots);
      progressInfo.textContent = `Loading FFmpeg core (31MB WASM file)${dots} ${Math.round(elapsedSeconds)}s elapsed`;
    }, 500);

    const loadPromise = ffmpeg.load({
      coreURL: coreJsUrl,
      wasmURL: coreWasmUrl
    }).then(() => {
      clearInterval(loadingInterval);
      progressInfo.textContent = 'FFmpeg core loaded successfully!';
    }).catch((error) => {
      clearInterval(loadingInterval);
      throw error;
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        clearInterval(loadingInterval);
        reject(new Error('FFmpeg core loading timed out. FFmpeg.wasm may not work in Chrome extensions. Please use the ZIP download option.'));
      }, 120000);
    });

    await Promise.race([loadPromise, timeoutPromise]);

    // Parse m3u8 to get segment URLs
    const segmentUrls = parseM3U8(data.m3u8Content, data.m3u8Url);

    if (segmentUrls.length === 0) {
      throw new Error('No segments found in m3u8 file');
    }

    // Download all segments
    progressInfo.textContent = 'Downloading segments...';
    const segments = [];
    let downloaded = 0;
    const total = segmentUrls.length;

    const batchSize = 5;
    for (let i = 0; i < segmentUrls.length; i += batchSize) {
      const batch = segmentUrls.slice(i, i + batchSize);

      await Promise.all(batch.map(async (url, idx) => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();

          // Extract filename
          let fileName;
          try {
            if (url.startsWith('http://') || url.startsWith('https://')) {
              const urlObj = new URL(url);
              const pathParts = urlObj.pathname.split('/');
              fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
            } else {
              fileName = url.split('?')[0].split('/').pop();
            }
            fileName = fileName.split('?')[0];
          } catch (error) {
            fileName = `seg-${i + idx + 1}.ts`;
          }

          segments.push({ name: fileName, data: arrayBuffer });
          downloaded++;

          const percent = Math.round((downloaded / total) * 50);
          progressFill.style.width = percent + '%';
          progressFill.textContent = `${percent}%`;
          progressInfo.textContent = `Downloaded ${downloaded} of ${total} segments`;
        } catch (error) {
          console.error(`[Stream Video Saver] Error downloading segment ${url}:`, error);
        }
      }));
    }

    // Write segments to FFmpeg filesystem
    progressInfo.textContent = 'Preparing segments for conversion...';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      await ffmpeg.writeFile(seg.name, new Uint8Array(seg.data));
      const percent = 50 + Math.round((i / segments.length) * 10);
      progressFill.style.width = percent + '%';
      progressFill.textContent = `${percent}%`;
    }

    // Create concat file for FFmpeg
    const concatContent = segments.map((seg) => `file '${seg.name}'`).join('\n');
    await ffmpeg.writeFile('concat.txt', concatContent);

    // Convert using FFmpeg
    progressInfo.textContent = 'Converting to MP4 (this may take a while)...';
    const outputFileName = data.m3u8FileName ? data.m3u8FileName.replace('.m3u8', '.mp4') : 'output.mp4';

    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat.txt',
      '-c', 'copy',
      outputFileName
    ]);

    // Read the output file
    progressInfo.textContent = 'Finalizing MP4 file...';
    const mp4Data = await ffmpeg.readFile(outputFileName);

    // Create download
    const blob = new Blob([mp4Data], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mp4FileName = `${data.m3u8FileName.replace('.m3u8', '')}-${timestamp}.mp4`;

    const a = document.createElement('a');
    a.href = url;
    a.download = mp4FileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    progressInfo.textContent = 'Download complete!';
    setTimeout(() => {
      progressDiv.classList.remove('active');
    }, 2000);
  }

  /**
   * Message listener for receiving updates from background script.
   * Handles download progress updates, download errors, and manifest capture notifications.
   * @param {Object} message - Message object from background script
   * @param {string} message.action - Action type ('downloadProgress' | 'downloadError' | 'manifestCaptured')
   * @returns {void}
   */
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'downloadProgress') {
      activeDownloadId = message.downloadId;
      const percent = Math.round((message.downloaded / message.total) * 100);
      progressFill.style.width = percent + '%';
      progressFill.textContent = `${percent}%`;

      if (message.status === 'creating_zip') {
        progressInfo.textContent = 'Creating ZIP file...';
      } else if (message.status === 'complete') {
        progressInfo.textContent = 'Download complete!';
        setTimeout(() => {
          progressDiv.classList.remove('active');
          activeDownloadId = null;
        }, 2000);
      } else if (message.status === 'cancelled') {
        progressInfo.textContent = 'Download cancelled';
        setTimeout(() => {
          progressDiv.classList.remove('active');
          activeDownloadId = null;
        }, 2000);
      } else {
        progressInfo.textContent = `Downloaded ${message.downloaded} of ${message.total} segments`;
      }
      progressDiv.classList.add('active');
      // Show cancel button when download is active
      if (cancelDownloadBtn && message.status !== 'complete' && message.status !== 'cancelled') {
        cancelDownloadBtn.style.display = 'block';
      } else if (cancelDownloadBtn) {
        cancelDownloadBtn.style.display = 'none';
      }
    } else if (message.action === 'downloadError') {
      showError(message.error || 'Download failed');
      progressDiv.classList.remove('active');
      activeDownloadId = null;
    } else if (message.action === 'manifestCaptured') {
      // New manifest detected
      console.log(`[Stream Video Saver] Manifest captured: ${message.fileName}`);
      updateStatus();
    }
  });

  // Old event listeners removed - downloads are now handled by downloadManifest() function

  /**
   * Displays an error message in the UI.
   * @param {string} message - The error message to display
   * @returns {void}
   */
  function showError(message) {
    errorDiv.textContent = 'Error: ' + message;
    errorDiv.classList.add('show');
  }

  /**
   * Parses an m3u8 playlist file and extracts segment URLs.
   * Handles absolute URLs, relative URLs, and URLs with query parameters.
   * Used by downloadAsMp4 function.
   * @param {string} content - The m3u8 file content as a string
   * @param {string} baseUrl - The base URL of the m3u8 file (used for resolving relative URLs)
   * @returns {Array<string>} Array of absolute segment URLs
   */
  function parseM3U8(content, baseUrl) {
    console.log(`[Stream Video Saver] Parsing m3u8 in popup, baseUrl: ${baseUrl}`);
    const lines = content.split('\n');
    const segmentUrls = [];

    if (!baseUrl) {
      console.warn('[Stream Video Saver] No baseUrl provided');
      return segmentUrls;
    }

    const base = new URL(baseUrl);
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    console.log(`[Stream Video Saver] Base origin: ${base.origin}, Base path: ${basePath}`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // This is a URL line (any non-comment, non-empty line)
      // This works for any segment naming convention
      if (line && !line.startsWith('#')) {
        let segmentUrl;

        // Handle relative URLs
        if (line.startsWith('http://') || line.startsWith('https://')) {
          segmentUrl = line;
        } else if (line.startsWith('/')) {
          segmentUrl = base.origin + line;
        } else {
          segmentUrl = base.origin + basePath + line;
        }

        segmentUrls.push(segmentUrl);
      }
    }

    console.log(`[Stream Video Saver] Parsed ${segmentUrls.length} segment URLs`);
    return segmentUrls;
  }

  // Old clearBtn event listener removed - clearing is now handled by clearManifest() function

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

  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
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
    if (response && response.manifestHistory) {
      console.log(`[Stream Video Saver] TEST - Found ${response.manifestHistory.length} manifests`);
      if (debugInfo) {
        debugInfo.textContent = `Debug: Found ${response.manifestHistory.length} manifests in response`;
        debugInfo.style.color = '#4caf50';
      }
      renderManifestHistory(response.manifestHistory);
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
  chrome.runtime.sendMessage({ action: 'getDownloadStatus' }, (response) => {
    if (response && response.downloads && response.downloads.length > 0) {
      const download = response.downloads[0]; // Show first active download
      activeDownloadId = download.downloadId;
      progressDiv.classList.add('active');
      const percent = Math.round((download.progress.downloaded / download.progress.total) * 100);
      progressFill.style.width = percent + '%';
      progressFill.textContent = `${percent}%`;
      if (download.progress.status === 'creating_zip') {
        progressInfo.textContent = 'Creating ZIP file...';
      } else {
        progressInfo.textContent = `Downloaded ${download.progress.downloaded} of ${download.progress.total} segments`;
      }
      if (cancelDownloadBtn && download.progress.status !== 'complete' && download.progress.status !== 'cancelled') {
        cancelDownloadBtn.style.display = 'block';
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

