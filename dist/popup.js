"use strict";
var PopupScript = (() => {
  // src/types/index.ts
  function isHTMLElement(value) {
    return value !== null && value instanceof HTMLElement;
  }
  function isHTMLDivElement(value) {
    return value !== null && value instanceof HTMLDivElement;
  }
  function isHTMLButtonElement(value) {
    return value !== null && value instanceof HTMLButtonElement;
  }

  // src/popup.ts
  console.log("[Stream Video Saver] popup.ts loaded - script is executing");
  window.addEventListener("error", (e) => {
    console.error(`[Stream Video Saver] Script error: ${e.message} in ${e.filename ?? "unknown"}:${e.lineno ?? "unknown"}`);
    const debugInfo = document.getElementById("debugInfo");
    if (debugInfo) {
      debugInfo.textContent = "ERROR: " + e.message + " in " + (e.filename ?? "unknown");
      debugInfo.style.color = "#d32f2f";
      debugInfo.style.background = "#ffebee";
    }
  }, true);
  try {
    const debugInfo = document.getElementById("debugInfo");
    if (debugInfo) {
      debugInfo.textContent = "Debug: Script loaded! Waiting for DOM...";
      debugInfo.style.color = "#2196f3";
      console.log("[Stream Video Saver] Debug info element found and updated");
    } else {
      console.error("[Stream Video Saver] Debug info element NOT found!");
    }
  } catch (error) {
    console.error("[Stream Video Saver] Error updating debug info:", error);
  }
  try {
    const statusDiv = document.getElementById("status");
    if (statusDiv) {
      statusDiv.textContent = "Script loaded - initializing...";
      console.log("[Stream Video Saver] Status div found and updated");
    } else {
      console.error("[Stream Video Saver] Status div NOT found!");
    }
  } catch (error) {
    console.error("[Stream Video Saver] Error updating status:", error);
  }
  var statusInterval = null;
  document.addEventListener("DOMContentLoaded", () => {
    console.log("[Stream Video Saver] DOMContentLoaded fired");
    const statusDiv = document.getElementById("status");
    const debugInfo = document.getElementById("debugInfo");
    if (statusDiv) {
      statusDiv.textContent = "Popup script loaded - checking for manifests...";
      statusDiv.className = "status";
    }
    if (debugInfo) {
      debugInfo.style.display = "block";
      debugInfo.textContent = "Debug: DOMContentLoaded fired, initializing...";
      debugInfo.style.color = "#2196f3";
    }
    const manifestHistoryDiv = document.getElementById("manifestHistory");
    const clearAllBtn = document.getElementById("clearAllBtn");
    const progressDiv = document.getElementById("progress");
    const progressFill = document.getElementById("progressFill");
    const progressInfo = document.getElementById("progressInfo");
    const errorDiv = document.getElementById("error");
    const cancelDownloadBtn = document.getElementById("cancelDownloadBtn");
    console.log("[Stream Video Saver] DOM elements found:", {
      statusDiv: !!statusDiv,
      manifestHistoryDiv: !!manifestHistoryDiv,
      clearAllBtn: !!clearAllBtn,
      progressDiv: !!progressDiv,
      progressFill: !!progressFill,
      progressInfo: !!progressInfo,
      errorDiv: !!errorDiv
    });
    if (!statusDiv || !manifestHistoryDiv) {
      console.error("[Stream Video Saver] CRITICAL: Required DOM elements not found!");
      if (statusDiv) {
        statusDiv.textContent = "ERROR: DOM elements not found!";
        statusDiv.style.background = "#ffebee";
        statusDiv.style.color = "#c62828";
      }
      return;
    }
    let selectedManifestId = null;
    let eventListenerAttached = false;
    let activeDownloadId = null;
    if (!eventListenerAttached) {
      manifestHistoryDiv.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const manifestId = target.getAttribute("data-manifest-id");
        if (!manifestId) {
          return;
        }
        if (target.classList.contains("btn-clear-manifest")) {
          clearManifest(manifestId);
        } else if (target.classList.contains("btn-download-zip")) {
          downloadManifest(manifestId, "zip");
        }
      });
      eventListenerAttached = true;
    }
    if (cancelDownloadBtn) {
      cancelDownloadBtn.addEventListener("click", () => {
        cancelDownload();
      });
    }
    function renderManifestHistory(manifests) {
      console.log(`[Stream Video Saver] renderManifestHistory called with ${manifests?.length ?? 0} manifests`);
      if (!manifestHistoryDiv || !statusDiv || !clearAllBtn) {
        console.error("[Stream Video Saver] DOM elements not found!");
        return;
      }
      if (!manifests || manifests.length === 0) {
        manifestHistoryDiv.innerHTML = "";
        statusDiv.textContent = "Monitoring for video streams...";
        statusDiv.className = "status";
        clearAllBtn.style.display = "none";
        console.log("[Stream Video Saver] Rendered empty state");
        return;
      }
      statusDiv.textContent = `${manifests.length} manifest${manifests.length > 1 ? "s" : ""} captured`;
      statusDiv.className = "status active";
      clearAllBtn.style.display = "block";
      const html = manifests.map((manifest) => {
        const date = new Date(manifest.capturedAt);
        const timeStr = date.toLocaleTimeString();
        const escapeHtml = (text) => {
          const div = document.createElement("div");
          div.textContent = text;
          return div.innerHTML;
        };
        const displayTitle = manifest.title || manifest.fileName;
        return `
        <div class="manifest-item" data-manifest-id="${escapeHtml(manifest.id)}">
          <div class="manifest-item-header">
            <span>${escapeHtml(displayTitle)}</span>
            <button class="btn-small secondary btn-clear-manifest" data-manifest-id="${escapeHtml(manifest.id)}" style="padding: 2px 6px; font-size: 10px;">\xD7</button>
          </div>
          <div class="manifest-item-name">${escapeHtml(displayTitle)}</div>
          <div class="manifest-item-info">
            ${manifest.segmentCount} segments \u2022 Captured at ${escapeHtml(timeStr)}
          </div>
          <div class="manifest-item-actions">
            <button class="button primary btn-download-zip" data-manifest-id="${escapeHtml(manifest.id)}" style="font-size: 11px; padding: 6px;">Download ZIP</button>
          </div>
        </div>
      `;
      }).join("");
      manifestHistoryDiv.innerHTML = html;
      console.log(`[Stream Video Saver] Rendered ${manifests.length} manifest items`);
    }
    function updateStatus() {
      console.log("[Stream Video Saver] updateStatus() called - sending getStatus message");
      try {
        chrome.runtime.sendMessage({ action: "getStatus" }, (response) => {
          console.log("[Stream Video Saver] getStatus callback invoked");
          console.log(`[Stream Video Saver] chrome.runtime.lastError: ${chrome.runtime.lastError?.message ?? "none"}`);
          console.log(`[Stream Video Saver] response:`, response);
          if (chrome.runtime.lastError) {
            console.error("[Stream Video Saver] Error getting status:", chrome.runtime.lastError);
            renderManifestHistory([]);
            return;
          }
          if (response && "manifestHistory" in response) {
            const statusResponse = response;
            console.log(`[Stream Video Saver] Rendering ${statusResponse.manifestHistory.length} manifests`);
            console.log(`[Stream Video Saver] Manifest data:`, statusResponse.manifestHistory);
            renderManifestHistory(statusResponse.manifestHistory);
          } else {
            console.log("[Stream Video Saver] No manifests in response, rendering empty list");
            console.log("[Stream Video Saver] Full response object:", response);
            renderManifestHistory([]);
          }
        });
      } catch (error) {
        console.error("[Stream Video Saver] Exception in updateStatus:", error);
        renderManifestHistory([]);
      }
    }
    async function downloadManifest(manifestId, _format) {
      if (!isHTMLDivElement(progressDiv) || !isHTMLElement(progressFill) || !isHTMLElement(progressInfo) || !isHTMLDivElement(errorDiv)) {
        console.error("[Stream Video Saver] Required DOM elements not found");
        return;
      }
      if (selectedManifestId === manifestId && progressDiv.classList.contains("active")) {
        console.log(`[Stream Video Saver] Download already in progress for manifest ${manifestId}, ignoring duplicate click`);
        return;
      }
      selectedManifestId = manifestId;
      errorDiv.classList.remove("show");
      progressDiv.classList.add("active");
      progressFill.style.width = "0%";
      progressFill.textContent = "0%";
      progressInfo.textContent = "Starting download...";
      if (isHTMLButtonElement(cancelDownloadBtn)) {
        cancelDownloadBtn.style.display = "block";
      }
      chrome.runtime.sendMessage({
        action: "startDownload",
        manifestId,
        format: "zip"
      }, (response) => {
        if (!isHTMLDivElement(progressDiv)) return;
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || "Unknown error";
          showError(errorMsg);
          progressDiv.classList.remove("active");
          if (isHTMLButtonElement(cancelDownloadBtn)) {
            cancelDownloadBtn.style.display = "none";
          }
        } else if (response && "error" in response) {
          const errorMsg = response.error || "Unknown error";
          showError(errorMsg);
          progressDiv.classList.remove("active");
          if (isHTMLButtonElement(cancelDownloadBtn)) {
            cancelDownloadBtn.style.display = "none";
          }
        }
      });
    }
    function cancelDownload() {
      if (!isHTMLDivElement(progressDiv) || !isHTMLElement(progressInfo)) return;
      if (activeDownloadId) {
        chrome.runtime.sendMessage({
          action: "cancelDownload",
          downloadId: activeDownloadId
        }, () => {
          activeDownloadId = null;
          progressDiv.classList.remove("active");
          progressInfo.textContent = "Download cancelled";
          if (isHTMLButtonElement(cancelDownloadBtn)) {
            cancelDownloadBtn.style.display = "none";
          }
        });
      }
    }
    function clearManifest(manifestId) {
      chrome.runtime.sendMessage({ action: "clearManifest", manifestId }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || "Unknown error";
          showError(errorMsg);
          return;
        }
        if (response && "success" in response) {
          updateStatus();
        }
      });
    }
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "clearManifest" }, (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || "Unknown error";
            showError(errorMsg);
            return;
          }
          if (response && "success" in response) {
            updateStatus();
          }
        });
      });
    }
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === "downloadProgress") {
        const progressMessage = message;
        activeDownloadId = progressMessage.downloadId;
        const percent = Math.round(progressMessage.downloaded / progressMessage.total * 100);
        if (isHTMLElement(progressFill)) {
          progressFill.style.width = percent + "%";
          progressFill.textContent = `${percent}%`;
        }
        if (progressMessage.status === "creating_zip") {
          if (isHTMLElement(progressInfo)) {
            progressInfo.textContent = "Creating ZIP file...";
          }
        } else if (progressMessage.status === "complete") {
          if (isHTMLElement(progressInfo)) {
            progressInfo.textContent = "Download complete!";
          }
          if (isHTMLDivElement(progressDiv)) {
            setTimeout(() => {
              progressDiv.classList.remove("active");
              activeDownloadId = null;
            }, 2e3);
          }
        } else if (progressMessage.status === "cancelled") {
          if (isHTMLElement(progressInfo)) {
            progressInfo.textContent = "Download cancelled";
          }
          if (isHTMLDivElement(progressDiv)) {
            setTimeout(() => {
              progressDiv.classList.remove("active");
              activeDownloadId = null;
            }, 2e3);
          }
        } else {
          if (isHTMLElement(progressInfo)) {
            progressInfo.textContent = `Downloaded ${progressMessage.downloaded} of ${progressMessage.total} segments`;
          }
        }
        if (isHTMLDivElement(progressDiv)) {
          progressDiv.classList.add("active");
        }
        if (isHTMLButtonElement(cancelDownloadBtn)) {
          if (progressMessage.status !== "complete" && progressMessage.status !== "cancelled") {
            cancelDownloadBtn.style.display = "block";
          } else {
            cancelDownloadBtn.style.display = "none";
          }
        }
      } else if (message.action === "downloadError") {
        const errorMessage = message;
        showError(errorMessage.error || "Download failed");
        if (isHTMLDivElement(progressDiv)) {
          progressDiv.classList.remove("active");
        }
        activeDownloadId = null;
      } else if (message.action === "manifestCaptured") {
        const capturedMessage = message;
        console.log(`[Stream Video Saver] Manifest captured: ${capturedMessage.fileName}`);
        updateStatus();
      }
    });
    function showError(message) {
      if (isHTMLDivElement(errorDiv)) {
        errorDiv.textContent = "Error: " + message;
        errorDiv.classList.add("show");
      }
    }
    if (typeof chrome === "undefined" || !chrome.runtime) {
      console.error("[Stream Video Saver] CRITICAL: chrome.runtime is not available!");
      if (statusDiv) {
        statusDiv.textContent = "ERROR: Chrome runtime not available!";
        statusDiv.style.background = "#ffebee";
        statusDiv.style.color = "#c62828";
      }
      return;
    }
    console.log("[Stream Video Saver] Testing message passing...");
    console.log("[Stream Video Saver] chrome.runtime available:", !!chrome.runtime);
    console.log("[Stream Video Saver] chrome.runtime.sendMessage available:", typeof chrome.runtime.sendMessage === "function");
    chrome.runtime.sendMessage({ action: "getStatus" }, (response) => {
      console.log("[Stream Video Saver] TEST - Response received:", response);
      console.log("[Stream Video Saver] TEST - Last error:", chrome.runtime.lastError);
      if (chrome.runtime.lastError) {
        console.error("[Stream Video Saver] TEST - Error:", chrome.runtime.lastError.message);
        if (statusDiv) {
          statusDiv.textContent = "ERROR: " + chrome.runtime.lastError.message;
          statusDiv.style.background = "#ffebee";
          statusDiv.style.color = "#c62828";
        }
        return;
      }
      if (response && "manifestHistory" in response) {
        const statusResponse = response;
        console.log(`[Stream Video Saver] TEST - Found ${statusResponse.manifestHistory.length} manifests`);
        if (debugInfo) {
          debugInfo.textContent = `Debug: Found ${statusResponse.manifestHistory.length} manifests in response`;
          debugInfo.style.color = "#4caf50";
        }
        renderManifestHistory(statusResponse.manifestHistory);
      } else {
        console.log("[Stream Video Saver] TEST - No manifests or invalid response");
        if (debugInfo) {
          debugInfo.textContent = "Debug: No manifests in response: " + JSON.stringify(response);
          debugInfo.style.color = "#ff9800";
        }
        if (statusDiv) {
          statusDiv.textContent = "No manifests found";
        }
      }
    });
    chrome.runtime.sendMessage({ action: "getDownloadStatus" }, (response) => {
      if (response && "downloads" in response) {
        const statusResponse = response;
        if (statusResponse.downloads && statusResponse.downloads.length > 0) {
          const download = statusResponse.downloads[0];
          activeDownloadId = download.downloadId;
          if (isHTMLDivElement(progressDiv) && isHTMLElement(progressFill)) {
            progressDiv.classList.add("active");
            const percent = Math.round(download.progress.downloaded / download.progress.total * 100);
            progressFill.style.width = percent + "%";
            progressFill.textContent = `${percent}%`;
          }
          if (isHTMLElement(progressInfo)) {
            if (download.progress.status === "creating_zip") {
              progressInfo.textContent = "Creating ZIP file...";
            } else {
              progressInfo.textContent = `Downloaded ${download.progress.downloaded} of ${download.progress.total} segments`;
            }
          }
          if (isHTMLButtonElement(cancelDownloadBtn) && download.progress.status !== "complete" && download.progress.status !== "cancelled") {
            cancelDownloadBtn.style.display = "block";
          }
        }
      }
    });
    console.log("[Stream Video Saver] Calling initial updateStatus()");
    updateStatus();
    console.log("[Stream Video Saver] Setting up interval to update status every 5 seconds");
    statusInterval = setInterval(updateStatus, 5e3);
    console.log("[Stream Video Saver] Popup initialization complete");
  });
})();
//# sourceMappingURL=popup.js.map
