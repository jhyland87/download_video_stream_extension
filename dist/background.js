importScripts('jszip.min.js');
"use strict";
var BackgroundScript = (() => {
  // src/background.ts
  var M3U8_PATTERN = /\.m3u8(\?|$)/i;
  var manifestHistory = [];
  var activeDownloads = /* @__PURE__ */ new Map();
  function generateManifestId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  console.log("[Stream Video Saver] Background script loaded");
  console.log("[Stream Video Saver] Starting continuous monitoring for m3u8 files...");
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      handleRequestCompleted(details);
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
  );
  console.log("[Stream Video Saver] \u2705 Continuous monitoring active");
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log(`[Stream Video Saver] Background received message: ${message.action}`);
    if (message.action === "getStatus") {
      const seen = /* @__PURE__ */ new Map();
      const filtered = manifestHistory.filter((m) => m.expectedSegments.length > 0).map((m) => ({
        id: m.id,
        fileName: m.m3u8FileName,
        title: m.title,
        url: m.m3u8Url,
        segmentCount: m.expectedSegments.length,
        capturedAt: m.capturedAt,
        urlKey: m.m3u8Url.split("?")[0]
        // URL without query params for deduplication
      })).filter((m) => {
        const existing = seen.get(m.urlKey);
        if (!existing || new Date(m.capturedAt) > new Date(existing.capturedAt)) {
          if (existing) {
            seen.delete(m.urlKey);
          }
          seen.set(m.urlKey, m);
          return true;
        }
        return false;
      }).map((m) => ({
        id: m.id,
        fileName: m.fileName,
        title: m.title,
        url: m.url,
        segmentCount: m.segmentCount,
        capturedAt: m.capturedAt
      })).sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
      console.log(`[Stream Video Saver] getStatus: returning ${filtered.length} manifests (filtered from ${manifestHistory.length} total, removed ${manifestHistory.length - filtered.length} with no segments or duplicates)`);
      console.log(`[Stream Video Saver] Manifest IDs: ${filtered.map((m) => m.id).join(", ")}`);
      const response = {
        manifestHistory: filtered
      };
      sendResponse(response);
      return true;
    } else if (message.action === "getManifestData") {
      const manifest = manifestHistory.find((m) => m.id === message.manifestId);
      if (manifest) {
        const response = {
          id: manifest.id,
          m3u8Url: manifest.m3u8Url,
          m3u8Content: manifest.m3u8Content,
          m3u8FileName: manifest.m3u8FileName,
          expectedSegments: manifest.expectedSegments
        };
        sendResponse(response);
      } else {
        sendResponse({ error: "Manifest not found" });
      }
    } else if (message.action === "clearManifest") {
      if (message.manifestId) {
        manifestHistory = manifestHistory.filter((m) => m.id !== message.manifestId);
        console.log(`[Stream Video Saver] \u2705 Manifest cleared: ${message.manifestId}. Remaining: ${manifestHistory.length}`);
      } else {
        manifestHistory = [];
        console.log("[Stream Video Saver] \u2705 All manifests cleared");
      }
      const response = { success: true };
      sendResponse(response);
    } else if (message.action === "segmentDownloaded") {
      const segmentUrl = message.segmentUrl;
      console.log(`[Stream Video Saver] \u{1F4E5} Segment downloaded: ${segmentUrl}`);
      const response = {
        success: true
      };
      sendResponse(response);
    } else if (message.action === "startDownload") {
      const { manifestId, format } = message;
      startDownload(manifestId, format).catch((error) => {
        console.error("[Stream Video Saver] Error starting download:", error);
      });
      const response = { success: true };
      sendResponse(response);
    } else if (message.action === "cancelDownload") {
      const { downloadId } = message;
      cancelDownload(downloadId);
      const response = { success: true };
      sendResponse(response);
    } else if (message.action === "getDownloadStatus") {
      const statuses = Array.from(activeDownloads.entries()).map(([id, download]) => ({
        downloadId: id,
        manifestId: download.manifestId,
        format: download.format,
        progress: download.progress || { downloaded: 0, total: 0, status: "starting" }
      }));
      const response = { downloads: statuses };
      sendResponse(response);
    }
    return true;
  });
  function parseM3U8(content, baseUrl) {
    console.log(`[Stream Video Saver] Parsing m3u8, baseUrl: ${baseUrl}`);
    const lines = content.split("\n");
    const segmentUrls = [];
    if (!baseUrl) {
      console.warn("[Stream Video Saver] No baseUrl provided for parsing");
      return segmentUrls;
    }
    const baseUrlWithoutQuery = baseUrl.split("?")[0];
    const base = new URL(baseUrlWithoutQuery);
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf("/") + 1);
    console.log(`[Stream Video Saver] Base origin: ${base.origin}`);
    console.log(`[Stream Video Saver] Base path: ${basePath}`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      if (line && !line.startsWith("#")) {
        let segmentUrl;
        if (line.startsWith("http://") || line.startsWith("https://")) {
          segmentUrl = line;
        } else if (line.startsWith("/")) {
          segmentUrl = base.origin + line;
        } else {
          segmentUrl = base.origin + basePath + line;
        }
        if (segmentUrls.length < 3) {
          console.log(`[Stream Video Saver] Found segment/manifest: ${line} -> ${segmentUrl}`);
        }
        segmentUrls.push(segmentUrl);
      }
    }
    console.log(`[Stream Video Saver] Total segments/manifests parsed: ${segmentUrls.length}`);
    return segmentUrls;
  }
  function parseInitSegments(content, baseUrl) {
    console.log(`[Stream Video Saver] Parsing m3u8 for init segments, baseUrl: ${baseUrl}`);
    const lines = content.split("\n");
    const initSegmentUrls = [];
    if (!baseUrl) {
      console.warn("[Stream Video Saver] No baseUrl provided for parsing init segments");
      return initSegmentUrls;
    }
    const baseUrlWithoutQuery = baseUrl.split("?")[0];
    const base = new URL(baseUrlWithoutQuery);
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf("/") + 1);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-MAP:")) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch && uriMatch[1]) {
          const uri = uriMatch[1];
          let initSegmentUrl;
          if (uri.startsWith("http://") || uri.startsWith("https://")) {
            initSegmentUrl = uri;
          } else if (uri.startsWith("/")) {
            initSegmentUrl = base.origin + uri;
          } else {
            initSegmentUrl = base.origin + basePath + uri;
          }
          console.log(`[Stream Video Saver] Found init segment: ${uri} -> ${initSegmentUrl}`);
          initSegmentUrls.push(initSegmentUrl);
        }
      }
    }
    console.log(`[Stream Video Saver] Total init segments parsed: ${initSegmentUrls.length}`);
    return initSegmentUrls;
  }
  var recentlyProcessed = /* @__PURE__ */ new Set();
  var PROCESSING_COOLDOWN = 5e3;
  async function handleRequestCompleted(details) {
    const url = details.url;
    if (!M3U8_PATTERN.test(url)) {
      return;
    }
    const urlWithoutQuery = url.split("?")[0];
    if (recentlyProcessed.has(urlWithoutQuery)) {
      return;
    }
    const existingManifest = manifestHistory.find((m) => {
      const existingUrlWithoutQuery = m.m3u8Url.split("?")[0];
      return existingUrlWithoutQuery === urlWithoutQuery;
    });
    if (existingManifest) {
      return;
    }
    recentlyProcessed.add(urlWithoutQuery);
    setTimeout(() => {
      recentlyProcessed.delete(urlWithoutQuery);
    }, PROCESSING_COOLDOWN);
    console.log(`[Stream Video Saver] \u2713 M3U8 file detected (new): ${url}`);
    try {
      console.log(`[Stream Video Saver] Fetching m3u8 content from: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[Stream Video Saver] Failed to fetch m3u8: ${response.status} ${response.statusText}`);
        return;
      }
      const text = await response.text();
      console.log(`[Stream Video Saver] M3U8 content length: ${text.length} chars`);
      console.log(`[Stream Video Saver] M3U8 content preview (first 500 chars): ${text.substring(0, 500)}`);
      const urlObj = new URL(url.split("?")[0]);
      const pathParts = urlObj.pathname.split("/");
      const fileName = pathParts[pathParts.length - 1] || "manifest.m3u8";
      if (!text.includes("#EXT-X-PLAYLIST-TYPE:VOD")) {
        console.log(`[Stream Video Saver] Skipping non-VOD manifest: ${fileName} (missing #EXT-X-PLAYLIST-TYPE:VOD)`);
        return;
      }
      const segmentUrls = parseM3U8(text, url);
      if (segmentUrls.length === 0) {
        console.log(`[Stream Video Saver] Skipping manifest with no segments: ${fileName}`);
        return;
      }
      const duplicateCheck = manifestHistory.find((m) => {
        const existingUrlWithoutQuery = m.m3u8Url.split("?")[0];
        return existingUrlWithoutQuery === urlWithoutQuery;
      });
      if (duplicateCheck) {
        console.log(`[Stream Video Saver] Duplicate detected during processing, skipping: ${fileName}`);
        return;
      }
      let title;
      if (details.tabId && details.tabId > 0) {
        try {
          const videoTitleResponse = await chrome.tabs.sendMessage(details.tabId, { action: "getVideoTitle" });
          if (videoTitleResponse && videoTitleResponse.title) {
            title = videoTitleResponse.title;
            console.log(`[Stream Video Saver] Found video title from content script: ${title}`);
          }
        } catch (error) {
          console.log("[Stream Video Saver] Could not get video title from content script, trying tab title");
        }
      }
      if (!title && details.tabId && details.tabId > 0) {
        try {
          const tab = await chrome.tabs.get(details.tabId);
          if (tab && tab.title) {
            title = tab.title;
            console.log(`[Stream Video Saver] Using tab title: ${title}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`[Stream Video Saver] Could not get tab title: ${errorMessage}`);
        }
      }
      const manifestId = generateManifestId();
      const manifest = {
        id: manifestId,
        m3u8Url: url,
        m3u8Content: text,
        m3u8FileName: fileName,
        title,
        expectedSegments: segmentUrls,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      manifestHistory.push(manifest);
      console.log(`[Stream Video Saver] \u2705 M3U8 captured and added to history: ${fileName}`);
      console.log(`[Stream Video Saver] \u{1F4CB} Found ${segmentUrls.length} segments`);
      console.log(`[Stream Video Saver] \u{1F4DA} Total manifests in history: ${manifestHistory.length}`);
      if (segmentUrls.length > 0) {
        console.log(`[Stream Video Saver] First few segments: ${segmentUrls.slice(0, 3)}`);
      }
      chrome.runtime.sendMessage({
        action: "manifestCaptured",
        manifestId,
        fileName,
        title,
        segmentCount: segmentUrls.length
      }).catch(() => {
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Stream Video Saver] Error fetching m3u8: ${errorMessage}`, error);
    }
  }
  async function startDownload(manifestId, format) {
    const downloadId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const abortController = new AbortController();
    const manifest = manifestHistory.find((m) => m.id === manifestId);
    if (!manifest) {
      notifyDownloadError(downloadId, "Manifest not found");
      return;
    }
    activeDownloads.set(downloadId, {
      manifestId,
      format,
      cancelled: false,
      abortController,
      progress: { downloaded: 0, total: 0, status: "starting" }
    });
    try {
      if (format === "zip") {
        await downloadAsZip(downloadId, manifest, abortController.signal);
      } else {
        notifyDownloadError(downloadId, `Unsupported download format: ${format}`);
        activeDownloads.delete(downloadId);
        return;
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        notifyDownloadError(downloadId, errorMessage);
      }
      activeDownloads.delete(downloadId);
    }
  }
  function cancelDownload(downloadId) {
    const download = activeDownloads.get(downloadId);
    if (download) {
      download.cancelled = true;
      download.abortController.abort();
      notifyDownloadProgress(downloadId, {
        downloaded: download.progress.downloaded,
        total: download.progress.total,
        status: "cancelled"
      });
      activeDownloads.delete(downloadId);
      if (activeDownloads.size === 0) {
        chrome.action.setBadgeText({ text: "" });
      }
    }
  }
  function sanitizeFilename(name, maxLength = 200) {
    let sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength).trim();
    }
    if (!sanitized) {
      return "video";
    }
    return sanitized;
  }
  async function downloadAsZip(downloadId, manifest, signal) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip library not loaded");
    }
    const zip = new JSZip();
    const modifiedM3U8Content = modifyM3U8ForLocalFiles(manifest.m3u8Content, manifest.m3u8Url);
    const m3u8FileName = manifest.m3u8Url.substring(manifest.m3u8Url.lastIndexOf("/") + 1).split("?")[0];
    zip.file(m3u8FileName, modifiedM3U8Content);
    const scriptTimestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const videoBaseName = manifest.title ? sanitizeFilename(manifest.title) : m3u8FileName.replace(".m3u8", "") || "output";
    const outputFileName = `${videoBaseName}-${scriptTimestamp}.mp4`;
    const templateUrl = chrome.runtime.getURL("templates/compile_video.sh.template");
    const templateResponse = await fetch(templateUrl);
    if (!templateResponse.ok) {
      throw new Error(`Failed to load template: ${templateResponse.status}`);
    }
    let bashScriptContent = await templateResponse.text();
    bashScriptContent = bashScriptContent.replace("{{MANIFEST_FILE}}", m3u8FileName).replace("{{OUTPUT_FILE}}", outputFileName);
    zip.file("compile_video.sh", bashScriptContent);
    const segmentUrls = parseM3U8(manifest.m3u8Content, manifest.m3u8Url);
    if (segmentUrls.length === 0) {
      throw new Error("No segments found in m3u8 file");
    }
    const initSegmentUrls = parseInitSegments(manifest.m3u8Content, manifest.m3u8Url);
    console.log(`[Stream Video Saver] Found ${initSegmentUrls.length} initialization segment(s)`);
    const total = segmentUrls.length + initSegmentUrls.length;
    let downloaded = 0;
    notifyDownloadProgress(downloadId, {
      downloaded: 0,
      total,
      status: "downloading"
    });
    if (initSegmentUrls.length > 0) {
      console.log("[Stream Video Saver] Downloading initialization segments...");
      for (const url of initSegmentUrls) {
        if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
          throw new Error("Download cancelled");
        }
        try {
          const response = await fetch(url, { signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          let fileName;
          try {
            if (url.startsWith("http://") || url.startsWith("https://")) {
              const urlObj = new URL(url);
              const pathParts = urlObj.pathname.split("/");
              fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || "init.mp4";
            } else {
              const urlParts = url.split("?")[0].split("/");
              fileName = urlParts[urlParts.length - 1] || "init.mp4";
            }
            fileName = fileName.split("?")[0];
          } catch (error) {
            fileName = url.substring(url.lastIndexOf("/") + 1).split("?")[0] || "init.mp4";
          }
          if (!fileName) {
            throw new Error("Could not extract filename from init segment URL");
          }
          zip.file(fileName, blob);
          downloaded++;
          const download = activeDownloads.get(downloadId);
          if (download) {
            download.progress = { downloaded, total, status: "downloading" };
          }
          notifyDownloadProgress(downloadId, {
            downloaded,
            total,
            status: "downloading"
          });
          console.log(`[Stream Video Saver] Downloaded init segment: ${fileName}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          console.error(`[Stream Video Saver] Failed to download init segment ${url}:`, errorMessage);
          throw new Error(`Failed to download initialization segment: ${errorMessage}`);
        }
      }
    }
    const batchSize = 5;
    for (let i = 0; i < segmentUrls.length; i += batchSize) {
      if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
        throw new Error("Download cancelled");
      }
      const batch = segmentUrls.slice(i, i + batchSize);
      await Promise.all(batch.map(async (url) => {
        if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
          return;
        }
        try {
          const response = await fetch(url, { signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          let fileName;
          try {
            if (url.startsWith("http://") || url.startsWith("https://")) {
              const urlObj = new URL(url);
              const pathParts = urlObj.pathname.split("/");
              fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || "segment.ts";
            } else {
              const urlParts = url.split("?")[0].split("/");
              fileName = urlParts[urlParts.length - 1] || "segment.ts";
            }
            fileName = fileName.split("?")[0];
          } catch (error) {
            fileName = url.substring(url.lastIndexOf("/") + 1).split("?")[0] || "segment.ts";
          }
          if (!fileName) {
            throw new Error("Could not extract filename from URL");
          }
          zip.file(fileName, blob);
          downloaded++;
          const download = activeDownloads.get(downloadId);
          if (download) {
            download.progress = { downloaded, total, status: "downloading" };
          }
          notifyDownloadProgress(downloadId, {
            downloaded,
            total,
            status: "downloading"
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw error;
          }
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Stream Video Saver] Error downloading segment ${url}:`, errorMessage);
        }
      }));
    }
    if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
      throw new Error("Download cancelled");
    }
    notifyDownloadProgress(downloadId, {
      downloaded,
      total,
      status: "creating_zip"
    });
    const zipArrayBuffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
      throw new Error("Download cancelled");
    }
    const bytes = new Uint8Array(zipArrayBuffer);
    let binary = "";
    const chunkSize = 8192;
    const totalChunks = Math.ceil(bytes.length / chunkSize);
    let processedChunks = 0;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      if (signal.aborted || activeDownloads.get(downloadId)?.cancelled) {
        throw new Error("Download cancelled");
      }
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
      processedChunks++;
      if (processedChunks % Math.max(1, Math.floor(totalChunks / 10)) === 0 || processedChunks === totalChunks) {
        notifyDownloadProgress(downloadId, {
          downloaded,
          total,
          status: "creating_zip"
        });
      }
    }
    const base64 = btoa(binary);
    const dataUrl = `data:application/zip;base64,${base64}`;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const zipBaseName = manifest.title ? sanitizeFilename(manifest.title) : manifest.m3u8FileName.replace(".m3u8", "") || "video";
    const zipFileName = `${zipBaseName}-${timestamp}.zip`;
    chrome.downloads.download({
      url: dataUrl,
      filename: zipFileName,
      saveAs: true
    }, (_chromeDownloadId) => {
      if (chrome.runtime.lastError) {
        const errorMessage = chrome.runtime.lastError.message || "Unknown error";
        notifyDownloadError(downloadId, errorMessage);
        activeDownloads.delete(downloadId);
      } else {
        notifyDownloadProgress(downloadId, {
          downloaded,
          total,
          status: "complete"
        });
        setTimeout(() => {
          activeDownloads.delete(downloadId);
          if (activeDownloads.size === 0) {
            chrome.action.setBadgeText({ text: "" });
          }
        }, 2e3);
      }
    });
  }
  function modifyM3U8ForLocalFiles(content, _baseUrl) {
    const lines = content.split("\n");
    const modifiedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("#EXT-X-MAP:")) {
        const uriMatch = trimmedLine.match(/URI="([^"]+)"/);
        if (uriMatch && uriMatch[1]) {
          const uri = uriMatch[1];
          let filename;
          try {
            if (uri.startsWith("http://") || uri.startsWith("https://")) {
              const url = new URL(uri);
              const pathParts = url.pathname.split("/");
              filename = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || "init.mp4";
            } else if (uri.startsWith("/")) {
              const pathParts = uri.split("/");
              filename = pathParts[pathParts.length - 1] || "init.mp4";
            } else {
              const urlParts = uri.split("?")[0].split("/");
              filename = urlParts[urlParts.length - 1] || "init.mp4";
            }
            if (filename) {
              filename = filename.split("?")[0];
              const modifiedLine = trimmedLine.replace(/URI="[^"]+"/, `URI="${filename}"`);
              modifiedLines.push(modifiedLine);
              console.log(`[Stream Video Saver] Updated #EXT-X-MAP URI: ${uri} -> ${filename}`);
              continue;
            }
          } catch (error) {
            console.warn(`[Stream Video Saver] Failed to parse init segment URI: ${uri}`, error);
          }
        }
        modifiedLines.push(line);
        continue;
      }
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        modifiedLines.push(line);
        continue;
      }
      try {
        let filename;
        if (trimmedLine.startsWith("http://") || trimmedLine.startsWith("https://")) {
          const url = new URL(trimmedLine);
          const pathParts = url.pathname.split("/");
          filename = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || "segment.ts";
        } else if (trimmedLine.startsWith("/")) {
          const pathParts = trimmedLine.split("/");
          filename = pathParts[pathParts.length - 1] || "segment.ts";
        } else {
          const urlParts = trimmedLine.split("?")[0].split("/");
          filename = urlParts[urlParts.length - 1] || "segment.ts";
        }
        if (!filename) {
          modifiedLines.push(line);
          continue;
        }
        filename = filename.split("?")[0];
        modifiedLines.push(filename);
      } catch (error) {
        modifiedLines.push(line);
      }
    }
    return modifiedLines.join("\n");
  }
  function updateBadge(progress) {
    if (progress.status === "complete" || progress.status === "cancelled") {
      chrome.action.setBadgeText({ text: "" });
    } else {
      const percent = Math.round(progress.downloaded / progress.total * 100);
      chrome.action.setBadgeText({ text: `${percent}%` });
      chrome.action.setBadgeBackgroundColor({ color: "#4caf50" });
    }
  }
  function notifyDownloadProgress(downloadId, progress) {
    updateBadge(progress);
    chrome.runtime.sendMessage({
      action: "downloadProgress",
      downloadId,
      ...progress
    }).catch(() => {
    });
  }
  function notifyDownloadError(downloadId, error) {
    chrome.action.setBadgeText({ text: "" });
    chrome.runtime.sendMessage({
      action: "downloadError",
      downloadId,
      error
    }).catch(() => {
    });
  }
})();
//# sourceMappingURL=background.js.map
