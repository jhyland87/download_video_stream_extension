/**
 * @fileoverview Content script for extracting video title and preview frames from the page
 * This script runs in the context of web pages to extract video metadata and capture frames
 */

import { logger } from './utils/logger.js';
import type {
  ExtensionMessage,
  ContentScriptResponse,
  GetVideoPreviewMessage,
  CreateBlobUrlMessage,
  ReceiveZipChunkMessage,
  CreateBlobUrlFromChunksMessage,
  CleanupZipChunksMessage,
  CreateBlobUrlFromStorageMessage
} from './types/index.js';
import {
  isGetVideoPreviewMessage,
  isCreateBlobUrlMessage,
  isReceiveZipChunkMessage,
  isCreateBlobUrlFromChunksMessage,
  isCleanupZipChunksMessage,
  isArrayBuffer,
  isFileReaderStringResult
} from './types/guards.js';

/**
 * Preview frame timestamps (in seconds) to capture from videos.
 * Modify this array to change which moments are captured for preview.
 */
const PREVIEW_TIMESTAMPS: readonly number[] = [3, 6, 9, 12, 15, 18, 21];

/**
 * Store ZIP chunks as they arrive (persists across messages)
 */
const zipChunks = new Map<number, ArrayBuffer>();

/**
 * Extracts video title from the page.
 * Tries multiple methods:
 * 1. Video element title attribute
 * 2. Meta tags (og:title, twitter:title, etc.)
 * 3. Page title
 * @returns The video title or null if not found
 */
function extractVideoTitle(): string | null {
  // Try to find video element with title
  const videoElements = document.getElementsByTagName('video');
  for (let i = 0; i < videoElements.length; i++) {
    const video = videoElements[i];
    if (video.title) {
      return video.title.trim();
    }
    // Check for aria-label
    const ariaLabel = video.getAttribute('aria-label');
    if (ariaLabel) {
      return ariaLabel.trim();
    }
  }

  // Try meta tags for video title
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const content = ogTitle.getAttribute('content');
    if (content) {
      return content.trim();
    }
  }

  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) {
    const content = twitterTitle.getAttribute('content');
    if (content) {
      return content.trim();
    }
  }

  // Try video-specific meta tags
  const videoTitle = document.querySelector('meta[property="video:title"]');
  if (videoTitle) {
    const content = videoTitle.getAttribute('content');
    if (content) {
      return content.trim();
    }
  }

  // Try h1 or main heading
  const h1 = document.querySelector('h1');
  if (h1 && h1.textContent) {
    const text = h1.textContent.trim();
    if (text && text.length > 0 && text.length < 200) {
      return text;
    }
  }

  return null;
}

/**
 * Helper to wrap setTimeout in a Promise
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to wait for a video event
 */
function waitForVideoEvent(video: HTMLVideoElement, eventName: string, timeout: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const timeoutId = setTimeout(() => {
    video.removeEventListener(eventName, handler);
    reject(new Error(`Video event ${eventName} timed out after ${timeout}ms`));
  }, timeout);

  const handler = (): void => {
    clearTimeout(timeoutId);
    video.removeEventListener(eventName, handler);
    resolve();
  };

  video.addEventListener(eventName, handler);

  return promise;
}

/**
 * Waits for a video element to be loaded (readyState >= 2 and has dimensions).
 * @param video - The video element to wait for
 * @param timeout - Maximum time to wait in milliseconds (default: 2000ms)
 * @returns Promise that resolves when video is loaded, or rejects on timeout
 */
async function waitForVideoLoad(video: HTMLVideoElement, timeout: number = 2000): Promise<void> {
  // If already loaded, return immediately
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    logger.log(' Video already loaded, no wait needed');
    return;
  }

  const startTime = Date.now();
  const checkInterval = 100; // Check every 100ms

  // Try to wait for events first (faster)
  try {
    await Promise.race([
      waitForVideoEvent(video, 'loadeddata', timeout),
      waitForVideoEvent(video, 'loadedmetadata', timeout)
    ]);
    // Verify dimensions after event fires
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      logger.log(' Video loaded via event');
      return;
    }
  } catch {
    // Events didn't fire, fall back to polling
  }

  // Poll for loaded state
  while (true) {
    const elapsed = Date.now() - startTime;

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      logger.log(`Video loaded after ${elapsed}ms - readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}`);
      return;
    }

    if (elapsed >= timeout) {
      logger.log(`Video load timeout after ${elapsed}ms - readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}`);
      throw new Error('Video load timeout');
    }

    await delay(checkInterval);
  }
}

/**
 * Waits for the video to naturally reach a specific time during user playback.
 * Only monitors timeupdate events - does NOT auto-play or alter playback speed.
 * If the video is not playing, this will wait indefinitely until the user plays it.
 * @param video - The video element to monitor
 * @param targetTime - Target time in seconds to wait for
 * @param timeout - Maximum time to wait in milliseconds (default: 30000ms)
 * @returns Promise that resolves when video reaches the target time during natural playback, or rejects on timeout
 */
async function waitForVideoTime(video: HTMLVideoElement, targetTime: number, timeout: number = 30000): Promise<void> {
  const tolerance = 0.3; // Capture within 0.3 seconds of target time

  // Check if video is already at target time
  if (video.currentTime >= targetTime - tolerance && video.currentTime <= targetTime + tolerance) {
    logger.log(`Video already at target time ${targetTime}s (current: ${video.currentTime}s)`);
    return;
  }

  // If video has already passed the target time, we've missed it
  if (video.currentTime > targetTime + tolerance) {
    throw new Error(`Video has already passed target time ${targetTime}s (current: ${video.currentTime}s)`);
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const timeoutId = setTimeout(() => {
    video.removeEventListener('timeupdate', checkTime);
    reject(new Error(`Video did not reach time ${targetTime}s within ${timeout}ms (video may not be playing)`));
  }, timeout);

  const checkTime = (): void => {
    // Only capture if video is actually playing (not paused)
    if (video.paused) {
      return; // Wait for user to play the video
    }

    const currentTime = video.currentTime;
    if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
      clearTimeout(timeoutId);
      video.removeEventListener('timeupdate', checkTime);
      logger.log(`Video reached target time ${targetTime}s during natural playback (current: ${currentTime}s)`);
      // Wait a bit for the frame to be rendered
      setTimeout(() => resolve(), 50);
    }
  };

  // Listen for timeupdate events (only fires when video is playing)
  video.addEventListener('timeupdate', checkTime);

  // Also check immediately in case timeupdate doesn't fire frequently enough
  checkTime();

  return promise;
}

/**
 * Captures a single frame from a video at the current time.
 * @param video - The video element
 * @param maxWidth - Maximum width for the preview (default: 320px)
 * @param maxHeight - Maximum height for the preview (default: 180px)
 * @returns Data URL of the captured frame, or null if capture fails
 */
function captureFrameAtCurrentTime(video: HTMLVideoElement, maxWidth: number = 320, maxHeight: number = 180): string | null {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      logger.warn(' Canvas context not available');
      return null;
    }

    // Calculate dimensions maintaining aspect ratio
    const aspectRatio = video.videoWidth / video.videoHeight;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspectRatio;
    }
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspectRatio;
    }

    canvas.width = width;
    canvas.height = height;

    // Draw the current video frame to canvas
    ctx.drawImage(video, 0, 0, width, height);

    // Convert to data URL (JPEG format for smaller size)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // 80% quality for balance between size and quality
    return dataUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log(`Could not capture video frame (likely CORS): ${errorMessage}`);
    return null;
  }
}

/**
 * Captures multiple preview frames from a video element at different timestamps.
 * Uses Canvas API to extract frames and convert them to data URLs.
 * Waits for videos to load if they're not ready yet.
 * @param maxWidth - Maximum width for the preview (default: 320px)
 * @param maxHeight - Maximum height for the preview (default: 180px)
 * @param timestamps - Array of timestamps in seconds to capture (default: [1, 3, 5])
 * @returns Array of data URLs of the captured frames, or empty array if capture fails
 */
async function captureVideoFrame(maxWidth: number = 320, maxHeight: number = 180, timestamps: number[] = [...PREVIEW_TIMESTAMPS], manifestId?: string): Promise<string[]> {
  logger.groupCollapsed(` captureVideoFrame (${maxWidth}x${maxHeight}, ${timestamps.length} timestamps)`);
  try {
    // First, try to find video elements in the main document
    const videoElements = document.getElementsByTagName('video');
    logger.log(`Found ${videoElements.length} video element(s) in main document`);

    let video: HTMLVideoElement | null = null;

      for (let i = 0; i < videoElements.length; i++) {
      const v = videoElements[i];
      logger.log(`Video element ${i}: readyState=${v.readyState}, videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}, src=${v.src?.substring(0, 100)}`);
      // Check if video is loaded and has dimensions
      if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
        video = v;
        logger.log(`Selected video element ${i} for preview capture`);
        break;
      }

      if (v.videoWidth > 0 && v.videoHeight > 0) {
        // Video has dimensions but readyState < 2 - we'll wait for it
        video = v;
        logger.log(`Selected video element ${i} (has dimensions but readyState < 2, will wait)`);
        break;
      }

      if (v.src || v.currentSrc) {
        // Video has a source but not loaded yet - we'll try waiting for it
        video = v;
        logger.log(`Selected video element ${i} (has source but not loaded, will wait)`);
        break;
      }
    }

    // If no video found in main document, try searching in iframes
    if (!video) {
      logger.log('No video found in main document, trying iframes...');
      const iframes = document.getElementsByTagName('iframe');
      logger.log(`Found ${iframes.length} iframe(s) on page`);

      for (let i = 0; i < iframes.length; i++) {
        const iframe = iframes[i];
        try {
          // Try to access iframe's contentDocument (may fail due to CORS)
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeVideos = iframeDoc.getElementsByTagName('video');
            logger.log(`Iframe ${i}: Found ${iframeVideos.length} video element(s)`);

            for (let j = 0; j < iframeVideos.length; j++) {
              const v = iframeVideos[j];
              logger.log(`Iframe ${i} video element ${j}: readyState=${v.readyState}, videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}`);
              // Accept video even if not fully loaded - we'll wait for it later
              if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
                video = v;
                logger.log(`Selected video element from iframe ${i}`);
                break;
              }

              if (v.videoWidth > 0 && v.videoHeight > 0) {
                // Video has dimensions but readyState < 2 - we'll wait for it
                video = v;
                logger.log(`Selected video element from iframe ${i} (has dimensions but readyState < 2, will wait)`);
                break;
              }

              if (v.src || v.currentSrc) {
                // Video has a source but not loaded yet - we'll try waiting for it
                video = v;
                logger.log(`Selected video element from iframe ${i} (has source but not loaded, will wait)`);
                break;
              }
            }
            if (video) break;
          } else {
            logger.log(`Iframe ${i}: Cannot access contentDocument (likely cross-origin)`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.log(`Iframe ${i}: Error accessing contentDocument: ${errorMessage}`);
        }
      }
    }

    if (!video) {
      logger.log('No video element found in main document or iframes');
      logger.groupEnd();
      return [];
    }

    // Wait for video to load if it's not ready yet
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      logger.log(`Video not fully loaded yet (readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}), waiting...`);
      try {
        await waitForVideoLoad(video, 3000); // Wait up to 3 seconds
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log(`Video did not load within timeout: ${errorMessage}`);
        logger.groupEnd();
        return [];
      }
    }

    // Check if video has duration (needed for timestamp checking)
    if (!video.duration || isNaN(video.duration) || !isFinite(video.duration)) {
      logger.log('Video duration not available, cannot capture frames at specific timestamps');
      logger.groupEnd();
      return []; // No preview if duration unavailable
    }

    const previewFrames: string[] = [];
    const capturedTimestamps = new Set<number>(); // Track which timestamps we've captured

    // Set up a passive listener that captures frames as the video naturally plays
    // This only captures when the user plays the video - completely transparent
    const timeUpdateHandler = (): void => {
      // Only capture if video is actually playing (not paused)
      if (video.paused) {
        return; // Wait for user to play the video
      }

      const currentTime = video.currentTime;
      const tolerance = 0.3;

      // Check each target timestamp to see if we've reached it
      for (const timestamp of timestamps) {
        const targetTime = Math.min(Math.max(0, timestamp), video.duration);

        // Skip if we've already captured this timestamp
        if (capturedTimestamps.has(targetTime)) {
          continue;
        }

        // Check if we're within tolerance of this timestamp
        if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
          const frame = captureFrameAtCurrentTime(video, maxWidth, maxHeight);
          if (frame) {
            previewFrames.push(frame);
            capturedTimestamps.add(targetTime);
            const frameIndex = previewFrames.length - 1;
            logger.log(`✅ Captured frame at ${targetTime}s during natural playback (${Math.round(frame.length / 1024)}KB)`);

            // Send individual frame to background script immediately (if manifestId provided)
            if (manifestId) {
              chrome.runtime.sendMessage({
                action: 'previewFrameReady',
                manifestId: manifestId,
                frameUrl: frame,
                frameIndex: frameIndex
              } as ExtensionMessage).catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.log(`Error sending individual preview frame: ${errorMessage}`);
              });
            }

            // If we've captured all timestamps, remove the listener
            if (capturedTimestamps.size === timestamps.length) {
              video.removeEventListener('timeupdate', timeUpdateHandler);
              logger.log(`✅ Captured all ${previewFrames.length} preview frame(s) during natural playback`);
            }
          }
          break; // Only capture one frame per timeupdate event
        }
      }
    };

    try {
      // Add listener for timeupdate events (only fires when video is playing)
      video.addEventListener('timeupdate', timeUpdateHandler);

      // Check immediately in case video is already at one of the target times and playing
      timeUpdateHandler();

      // Set a timeout to remove the listener after a reasonable time
      // This prevents the listener from staying active forever if user never plays the video
      setTimeout(() => {
        video.removeEventListener('timeupdate', timeUpdateHandler);
        if (previewFrames.length === 0) {
          logger.log('No preview frames captured - video was not played by user');
        } else {
          logger.log(`✅ Captured ${previewFrames.length} preview frame(s) total (stopping listener after timeout)`);
        }
      }, 300000); // 5 minutes timeout - if user hasn't played video by then, give up

      // Return immediately - frames will be captured asynchronously as video plays
      // The listener will send individual frames via previewFrameReady messages
      logger.log(`Preview capture listener active - will capture frames as video naturally plays`);
      logger.groupEnd();
      return previewFrames; // May be empty initially, will be populated as video plays
    } catch (error) {
      // CORS or other error - video might be cross-origin
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log(`Could not capture video frames (likely CORS): ${errorMessage}`);
      logger.groupEnd();
      return [];
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error capturing video frame: ${errorMessage}`);
    logger.groupEnd();
    return [];
  }
}

/**
 * Message listener for title extraction and preview frame requests
 */
chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: ContentScriptResponse) => void
): boolean => {
  if (message.action === 'getVideoTitle') {
    const title = extractVideoTitle();
    sendResponse({ title });
    return true;
  }

  if (isGetVideoPreviewMessage(message)) {
    const manifestId = message.manifestId;
    logger.groupCollapsed(` getVideoPreview (manifestId: ${manifestId || 'none'})`);

    // Handle async operation
    (async (): Promise<void> => {
      try {
        const previewUrls = await captureVideoFrame(320, 180, [...PREVIEW_TIMESTAMPS], manifestId);
        if (previewUrls && previewUrls.length > 0) {
          logger.log(`Sending ${previewUrls.length} preview URL(s) back (first frame length: ${previewUrls[0].length})`);
        } else {
          logger.log('Could not capture preview - returning empty array');
        }
        sendResponse({ previewUrls: previewUrls || [] });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error capturing preview: ${errorMessage}`);
        sendResponse({ previewUrls: [] });
      } finally {
        logger.groupEnd();
      }
    })();

    return true; // Indicate we will send response asynchronously
  }

  // Handle createBlobUrl message
  if (isCreateBlobUrlMessage(message)) {
    try {
      if (!isArrayBuffer(message.arrayBuffer)) {
        sendResponse({ error: 'Invalid arrayBuffer in message' });
        return true;
      }
      const blob = new Blob([message.arrayBuffer], { type: message.mimeType });
      const blobUrl = URL.createObjectURL(blob);
      sendResponse({ blobUrl });
      logger.log(`Content script created Blob URL: ${blobUrl}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      sendResponse({ error: `Failed to create Blob URL: ${errorMessage}` });
      logger.error(`Content script failed to create Blob URL: ${errorMessage}`);
    }
    return true;
  }

  // Handle receiveZipChunk message
  if (isReceiveZipChunkMessage(message)) {
    const chunkIndex = message.chunkIndex;
    const chunkDataBase64 = message.chunkDataBase64;

    // Convert base64 string back to ArrayBuffer
    const binary = atob(chunkDataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const chunkArrayBuffer = bytes.buffer;

    zipChunks.set(chunkIndex, chunkArrayBuffer);
    logger.log(`Content script received chunk ${chunkIndex + 1} (${(chunkArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    sendResponse({ received: true });
    return true;
  }

  // Handle createBlobUrlFromChunks message
  if (isCreateBlobUrlFromChunksMessage(message)) {
    (async (): Promise<void> => {
      try {
        const totalChunks = message.totalChunks;
        const mimeType = message.mimeType;
        const filename = message.filename;

        logger.log(`Content script reconstructing ZIP from ${totalChunks} chunk(s)...`);
        logger.log(`Chunks in map: ${zipChunks.size}`);

        // Reconstruct ArrayBuffer from chunks
        const chunks: ArrayBuffer[] = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunk = zipChunks.get(i);
          if (!chunk) {
            logger.error(`Missing chunk ${i}, available chunks: ${Array.from(zipChunks.keys()).join(', ')}`);
            throw new Error(`Missing chunk ${i}`);
          }
          chunks.push(chunk);
        }

        // Combine ArrayBuffers
        const totalLength = chunks.reduce((sum, ab) => sum + ab.byteLength, 0);
        logger.log(`Total length to combine: ${totalLength} bytes`);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          const chunkView = new Uint8Array(chunk);
          combined.set(chunkView, offset);
          offset += chunk.byteLength;
        }

        logger.log(`Content script reconstructed ${(combined.byteLength / 1024 / 1024).toFixed(2)} MB from chunks`);

        // Convert blob to data URL for background script
        // Blob URLs created in content script are scoped to page origin, not accessible from background
        const blob = new Blob([combined], { type: mimeType });

        // For large files, convert to base64 data URL in chunks
        const MAX_DATA_URL_SIZE = 50 * 1024 * 1024; // 50MB limit for data URLs
        if (combined.byteLength > MAX_DATA_URL_SIZE) {
          // File too large for data URL - need alternative approach
          // Create a temporary anchor element and trigger download from content script
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Clean up blob URL after a delay
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

          logger.log(`Triggered download via anchor element (file too large for data URL)`);
          sendResponse({ success: true, method: 'anchor' });
        } else {
          // Convert to base64 data URL
          const reader = new FileReader();
          reader.onload = () => {
            if (!isFileReaderStringResult(reader.result)) {
              sendResponse({ error: 'Failed to convert blob to data URL: result is not a string' });
              return;
            }
            const dataUrl = reader.result;
            logger.log(`Content script created data URL (${(dataUrl.length / 1024 / 1024).toFixed(2)} MB)`);
            sendResponse({ dataUrl: dataUrl });
          };
          reader.onerror = () => {
            sendResponse({ error: 'Failed to convert blob to data URL' });
          };
          reader.readAsDataURL(blob);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendResponse({ error: `Failed to create Blob URL from chunks: ${errorMessage}` });
        logger.error(`Content script failed to create Blob URL from chunks: ${errorMessage}`);
      }
    })();
    return true; // Indicate we will send response asynchronously
  }

  // Handle cleanupZipChunks message
  if (isCleanupZipChunksMessage(message)) {
    const totalChunks = message.totalChunks;
    for (let i = 0; i < totalChunks; i++) {
      zipChunks.delete(i);
    }
    logger.log(`Content script cleaned up ${totalChunks} chunk(s)`);
    sendResponse({ cleaned: true });
    return true;
  }

  // Handle createBlobUrlFromStorage message (legacy, kept for compatibility)
  if (message.action === 'createBlobUrlFromStorage') {
    const storageMessage = message as CreateBlobUrlFromStorageMessage;
    (async (): Promise<void> => {
      try {
        const storageKey = storageMessage.storageKey;
        if (!storageKey) {
          sendResponse({ error: 'Missing storageKey in message' });
          return;
        }

        logger.log(`Content script reading ZIP from chrome.storage.local with key: ${storageKey}`);

        // Read chunks from chrome.storage.local
        const result = await chrome.storage.local.get([
          `${storageKey}_chunks`,
          `${storageKey}_mimeType`,
          `${storageKey}_filename`
        ]);

        const totalChunks = parseInt(result[`${storageKey}_chunks`] || '0', 10);
        const mimeType = result[`${storageKey}_mimeType`] || 'application/zip';

        if (totalChunks === 0) {
          throw new Error(`No chunks found in storage for key: ${storageKey}`);
        }

        logger.log(`Reading ${totalChunks} chunk(s) from storage...`);

        // Read all chunks
        const chunkKeys: string[] = [];
        for (let i = 0; i < totalChunks; i++) {
          chunkKeys.push(`${storageKey}_chunk_${i}`);
        }

        const chunksResult = await chrome.storage.local.get(chunkKeys);
        const chunks: string[] = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunkBase64 = chunksResult[`${storageKey}_chunk_${i}`];
          if (!chunkBase64) {
            throw new Error(`Missing chunk ${i} in storage for key: ${storageKey}`);
          }
          chunks.push(chunkBase64);
        }

        // Convert base64 chunks back to ArrayBuffer
        const arrayBuffers: ArrayBuffer[] = [];
        for (const chunkBase64 of chunks) {
          const binary = atob(chunkBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          arrayBuffers.push(bytes.buffer);
        }

        // Combine ArrayBuffers into one
        const totalLength = arrayBuffers.reduce((sum, ab) => sum + ab.byteLength, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const ab of arrayBuffers) {
          combined.set(new Uint8Array(ab), offset);
          offset += ab.byteLength;
        }

        logger.log(`Content script reconstructed ${(combined.byteLength / 1024 / 1024).toFixed(2)} MB from storage`);

        // Create Blob URL from the combined ArrayBuffer
        const blob = new Blob([combined], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        sendResponse({ blobUrl });
        logger.log(`Content script created Blob URL from storage: ${blobUrl}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendResponse({ error: `Failed to create Blob URL from storage: ${errorMessage}` });
        logger.error(`Content script failed to create Blob URL from storage: ${errorMessage}`);
      }
    })();
    return true; // Indicate we will send response asynchronously
  }

  return false;
});
