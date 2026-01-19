/**
 * @fileoverview Content script for extracting video title and preview frames from the page
 * This script runs in the context of web pages to extract video metadata and capture frames
 */

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
    console.log('[Stream Video Saver] Video already loaded, no wait needed');
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
      console.log('[Stream Video Saver] Video loaded via event');
      return;
    }
  } catch {
    // Events didn't fire, fall back to polling
  }

  // Poll for loaded state
  while (true) {
    const elapsed = Date.now() - startTime;

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      console.log(`[Stream Video Saver] Video loaded after ${elapsed}ms - readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}`);
      return;
    }

    if (elapsed >= timeout) {
      console.log(`[Stream Video Saver] Video load timeout after ${elapsed}ms - readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}`);
      throw new Error('Video load timeout');
    }

    await delay(checkInterval);
  }
}

/**
 * Waits for the video to naturally reach a specific time during playback.
 * Monitors timeupdate events and captures when the video reaches the target time.
 * @param video - The video element to monitor
 * @param targetTime - Target time in seconds to wait for
 * @param timeout - Maximum time to wait in milliseconds (default: 10000ms)
 * @returns Promise that resolves when video reaches the target time, or rejects on timeout
 */
async function waitForVideoTime(video: HTMLVideoElement, targetTime: number, timeout: number = 10000): Promise<void> {
  const tolerance = 0.3; // Capture within 0.3 seconds of target time
  const startTime = Date.now();
  const wasPlaying = !video.paused;
  const originalPlaybackRate = video.playbackRate;

  // Start playing if not already playing (at faster rate to speed up capture)
  if (video.paused) {
    video.playbackRate = 2.0; // Play at 2x speed to capture frames faster
    await video.play();
  }

  // If video is before target, wait for it to reach it
  // If video is after target, we've already missed it, so just capture current frame
  if (video.currentTime >= targetTime - tolerance && video.currentTime <= targetTime + tolerance) {
    console.log(`[Stream Video Saver] Video already at target time ${targetTime}s (current: ${video.currentTime}s)`);
    return;
  }

  if (video.currentTime > targetTime + tolerance) {
    // Video has already passed the target time, can't capture it naturally
    throw new Error(`Video has already passed target time ${targetTime}s (current: ${video.currentTime}s)`);
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const timeoutId = setTimeout(() => {
    video.removeEventListener('timeupdate', checkTime);
    if (!wasPlaying) {
      video.pause();
      video.playbackRate = originalPlaybackRate;
    }
    reject(new Error(`Video did not reach time ${targetTime}s within ${timeout}ms`));
  }, timeout);

  const checkTime = (): void => {
    const currentTime = video.currentTime;
    if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
      clearTimeout(timeoutId);
      video.removeEventListener('timeupdate', checkTime);

      // Restore playback state if we changed it
      if (!wasPlaying) {
        video.pause();
        video.playbackRate = originalPlaybackRate;
      }

      console.log(`[Stream Video Saver] Video reached target time ${targetTime}s (current: ${currentTime}s)`);
      // Wait a bit for the frame to be rendered
      setTimeout(() => resolve(), 50);
    }
  };

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
      console.warn('[Stream Video Saver] Canvas context not available');
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
    console.log(`[Stream Video Saver] Could not capture video frame (likely CORS): ${errorMessage}`);
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
  console.groupCollapsed(`[Stream Video Saver] captureVideoFrame (${maxWidth}x${maxHeight}, ${timestamps.length} timestamps)`);
  try {
    // First, try to find video elements in the main document
    const videoElements = document.getElementsByTagName('video');
    console.log(`Found ${videoElements.length} video element(s) in main document`);

    let video: HTMLVideoElement | null = null;

      for (let i = 0; i < videoElements.length; i++) {
      const v = videoElements[i];
      console.log(`Video element ${i}: readyState=${v.readyState}, videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}, src=${v.src?.substring(0, 100)}`);
      // Check if video is loaded and has dimensions
      if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
        video = v;
        console.log(`Selected video element ${i} for preview capture`);
        break;
      }

      if (v.videoWidth > 0 && v.videoHeight > 0) {
        // Video has dimensions but readyState < 2 - we'll wait for it
        video = v;
        console.log(`Selected video element ${i} (has dimensions but readyState < 2, will wait)`);
        break;
      }

      if (v.src || v.currentSrc) {
        // Video has a source but not loaded yet - we'll try waiting for it
        video = v;
        console.log(`Selected video element ${i} (has source but not loaded, will wait)`);
        break;
      }
    }

    // If no video found in main document, try searching in iframes
    if (!video) {
      console.log('No video found in main document, trying iframes...');
      const iframes = document.getElementsByTagName('iframe');
      console.log(`Found ${iframes.length} iframe(s) on page`);

      for (let i = 0; i < iframes.length; i++) {
        const iframe = iframes[i];
        try {
          // Try to access iframe's contentDocument (may fail due to CORS)
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeVideos = iframeDoc.getElementsByTagName('video');
            console.log(`Iframe ${i}: Found ${iframeVideos.length} video element(s)`);

            for (let j = 0; j < iframeVideos.length; j++) {
              const v = iframeVideos[j];
              console.log(`Iframe ${i} video element ${j}: readyState=${v.readyState}, videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}`);
              // Accept video even if not fully loaded - we'll wait for it later
              if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
                video = v;
                console.log(`Selected video element from iframe ${i}`);
                break;
              }

              if (v.videoWidth > 0 && v.videoHeight > 0) {
                // Video has dimensions but readyState < 2 - we'll wait for it
                video = v;
                console.log(`Selected video element from iframe ${i} (has dimensions but readyState < 2, will wait)`);
                break;
              }

              if (v.src || v.currentSrc) {
                // Video has a source but not loaded yet - we'll try waiting for it
                video = v;
                console.log(`Selected video element from iframe ${i} (has source but not loaded, will wait)`);
                break;
              }
            }
            if (video) break;
          } else {
            console.log(`Iframe ${i}: Cannot access contentDocument (likely cross-origin)`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`Iframe ${i}: Error accessing contentDocument: ${errorMessage}`);
        }
      }
    }

    if (!video) {
      console.log('No video element found in main document or iframes');
      console.groupEnd();
      return [];
    }

    // Wait for video to load if it's not ready yet
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      console.log(`Video not fully loaded yet (readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}), waiting...`);
      try {
        await waitForVideoLoad(video, 3000); // Wait up to 3 seconds
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`Video did not load within timeout: ${errorMessage}`);
        console.groupEnd();
        return [];
      }
    }

    // Check if video has duration (needed for seeking)
    if (!video.duration || isNaN(video.duration) || !isFinite(video.duration)) {
      console.log('Video duration not available, cannot seek to specific timestamps');
      // Fallback to current frame
      const frame = captureFrameAtCurrentTime(video, maxWidth, maxHeight);
      console.groupEnd();
      return frame ? [frame] : [];
    }

    const previewFrames: string[] = [];

    try {
      // Capture frames at specified timestamps as video naturally plays
      for (const timestamp of timestamps) {
        // Clamp timestamp to video duration
        const targetTime = Math.min(Math.max(0, timestamp), video.duration);

        console.log(`Waiting for video to reach ${targetTime}s (duration: ${video.duration}s, current: ${video.currentTime}s)`);

        try {
          await waitForVideoTime(video, targetTime, 10000);
          const frame = captureFrameAtCurrentTime(video, maxWidth, maxHeight);
          if (frame) {
            previewFrames.push(frame);
            console.log(`✅ Captured frame at ${targetTime}s (${Math.round(frame.length / 1024)}KB)`);

            // Send individual frame to background script immediately (if manifestId provided)
            if (manifestId) {
              chrome.runtime.sendMessage({
                action: 'previewFrameReady',
                manifestId: manifestId,
                frameUrl: frame,
                frameIndex: previewFrames.length - 1
              } as ExtensionMessage).catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.log(`Error sending individual preview frame: ${errorMessage}`);
              });
            }
          } else {
            console.log(`Failed to capture frame at ${targetTime}s`);
          }
        } catch (timeError) {
          const errorMessage = timeError instanceof Error ? timeError.message : String(timeError);
          console.log(`Error waiting for video time ${targetTime}s: ${errorMessage}`);
          // Continue with next timestamp
        }
      }

      if (previewFrames.length === 0) {
        console.log('No frames captured, trying fallback to current frame');
        // Fallback to current frame if no frames captured
        const frame = captureFrameAtCurrentTime(video, maxWidth, maxHeight);
        if (frame) {
          previewFrames.push(frame);
        }
      }

      console.log(`✅ Captured ${previewFrames.length} preview frame(s) total`);
      console.groupEnd();
      return previewFrames;
    } catch (error) {
      // CORS or other error - video might be cross-origin
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`Could not capture video frames (likely CORS): ${errorMessage}`);
      console.groupEnd();
      return [];
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error capturing video frame: ${errorMessage}`);
    console.groupEnd();
    return [];
  }
}

/**
 * Message listener for title extraction and preview frame requests
 */
chrome.runtime.onMessage.addListener((
  message: { action: string },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: { title?: string | null; previewUrl?: string | null; previewUrls?: string[]; blobUrl?: string; error?: string; received?: boolean; cleaned?: boolean; success?: boolean; downloadId?: number; method?: string; dataUrl?: string }) => void
): boolean => {
  if (message.action === 'getVideoTitle') {
    const title = extractVideoTitle();
    sendResponse({ title });
    return true;
  }

  if (message.action === 'getVideoPreview') {
    const manifestId = (message as { manifestId?: string }).manifestId;
    console.groupCollapsed(`[Stream Video Saver] getVideoPreview (manifestId: ${manifestId || 'none'})`);

    // Handle async operation
    (async (): Promise<void> => {
      try {
        const previewUrls = await captureVideoFrame(320, 180, [...PREVIEW_TIMESTAMPS], manifestId);
        if (previewUrls && previewUrls.length > 0) {
          console.log(`Sending ${previewUrls.length} preview URL(s) back (first frame length: ${previewUrls[0].length})`);
        } else {
          console.log('Could not capture preview - returning empty array');
        }
        sendResponse({ previewUrls: previewUrls || [] });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error capturing preview: ${errorMessage}`);
        sendResponse({ previewUrls: [] });
      } finally {
        console.groupEnd();
      }
    })();

    return true; // Indicate we will send response asynchronously
  }

  // Handle createBlobUrl message
  if (message.action === 'createBlobUrl' && 'arrayBuffer' in message && 'mimeType' in message) {
    try {
      const blob = new Blob([message.arrayBuffer as ArrayBuffer], { type: message.mimeType as string });
      const blobUrl = URL.createObjectURL(blob);
      sendResponse({ blobUrl });
      console.log(`[Stream Video Saver] Content script created Blob URL: ${blobUrl}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      sendResponse({ error: `Failed to create Blob URL: ${errorMessage}` });
      console.error(`[Stream Video Saver] Content script failed to create Blob URL: ${errorMessage}`);
    }
    return true;
  }

  // Handle receiveZipChunk message
  if (message.action === 'receiveZipChunk' && 'chunkIndex' in message && 'chunkDataBase64' in message) {
    const chunkIndex = (message as { chunkIndex: number }).chunkIndex;
    const chunkDataBase64 = (message as { chunkDataBase64: string }).chunkDataBase64;

    // Convert base64 string back to ArrayBuffer
    const binary = atob(chunkDataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const chunkArrayBuffer = bytes.buffer;

    zipChunks.set(chunkIndex, chunkArrayBuffer);
    console.log(`[Stream Video Saver] Content script received chunk ${chunkIndex + 1} (${(chunkArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    sendResponse({ received: true });
    return true;
  }

  // Handle createBlobUrlFromChunks message
  if (message.action === 'createBlobUrlFromChunks' && 'totalChunks' in message && 'mimeType' in message && 'filename' in message) {
    (async (): Promise<void> => {
      try {
        const totalChunks = (message as { totalChunks: number }).totalChunks;
        const mimeType = (message as { mimeType: string }).mimeType;
        const filename = (message as { filename: string }).filename;

        console.log(`[Stream Video Saver] Content script reconstructing ZIP from ${totalChunks} chunk(s)...`);
        console.log(`[Stream Video Saver] Chunks in map: ${zipChunks.size}`);

        // Reconstruct ArrayBuffer from chunks
        const chunks: ArrayBuffer[] = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunk = zipChunks.get(i);
          if (!chunk) {
            console.error(`[Stream Video Saver] Missing chunk ${i}, available chunks: ${Array.from(zipChunks.keys()).join(', ')}`);
            throw new Error(`Missing chunk ${i}`);
          }
          chunks.push(chunk);
        }

        // Combine ArrayBuffers
        const totalLength = chunks.reduce((sum, ab) => sum + ab.byteLength, 0);
        console.log(`[Stream Video Saver] Total length to combine: ${totalLength} bytes`);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          const chunkView = new Uint8Array(chunk);
          combined.set(chunkView, offset);
          offset += chunk.byteLength;
        }

        console.log(`[Stream Video Saver] Content script reconstructed ${(combined.byteLength / 1024 / 1024).toFixed(2)} MB from chunks`);
        
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
          
          console.log(`[Stream Video Saver] Triggered download via anchor element (file too large for data URL)`);
          sendResponse({ success: true, method: 'anchor' });
        } else {
          // Convert to base64 data URL
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            console.log(`[Stream Video Saver] Content script created data URL (${(dataUrl.length / 1024 / 1024).toFixed(2)} MB)`);
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
        console.error(`[Stream Video Saver] Content script failed to create Blob URL from chunks: ${errorMessage}`);
      }
    })();
    return true; // Indicate we will send response asynchronously
  }

  // Handle cleanupZipChunks message
  if (message.action === 'cleanupZipChunks' && 'totalChunks' in message) {
    const totalChunks = (message as { totalChunks: number }).totalChunks;
    for (let i = 0; i < totalChunks; i++) {
      zipChunks.delete(i);
    }
    console.log(`[Stream Video Saver] Content script cleaned up ${totalChunks} chunk(s)`);
    sendResponse({ cleaned: true });
    return true;
  }

  // Handle createBlobUrlFromStorage message (legacy, kept for compatibility)
  if (message.action === 'createBlobUrlFromStorage' && 'storageKey' in message) {
    (async (): Promise<void> => {
      try {
        const storageKey = (message as { storageKey: string }).storageKey;

        console.log(`[Stream Video Saver] Content script reading ZIP from chrome.storage.local with key: ${storageKey}`);

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

        console.log(`[Stream Video Saver] Reading ${totalChunks} chunk(s) from storage...`);

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

        console.log(`[Stream Video Saver] Content script reconstructed ${(combined.byteLength / 1024 / 1024).toFixed(2)} MB from storage`);

        // Create Blob URL from the combined ArrayBuffer
        const blob = new Blob([combined], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        sendResponse({ blobUrl });
        console.log(`[Stream Video Saver] Content script created Blob URL from storage: ${blobUrl}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendResponse({ error: `Failed to create Blob URL from storage: ${errorMessage}` });
        console.error(`[Stream Video Saver] Content script failed to create Blob URL from storage: ${errorMessage}`);
      }
    })();
    return true; // Indicate we will send response asynchronously
  }

  return false;
});
