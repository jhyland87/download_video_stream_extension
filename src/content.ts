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
 * Waits for the video to seek to a specific time and be ready.
 * @param video - The video element to seek
 * @param time - Time in seconds to seek to
 * @param timeout - Maximum time to wait in milliseconds (default: 2000ms)
 * @returns Promise that resolves when seek is complete, or rejects on timeout
 */
async function waitForVideoSeek(video: HTMLVideoElement, time: number, timeout: number = 2000): Promise<void> {
  video.currentTime = time;
  await waitForVideoEvent(video, 'seeked', timeout);
  // Wait a bit for the frame to be rendered
  await delay(100);
  console.log(`[Stream Video Saver] Video seeked to ${time}s successfully`);
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
async function captureVideoFrame(maxWidth: number = 320, maxHeight: number = 180, timestamps: number[] = [...PREVIEW_TIMESTAMPS]): Promise<string[]> {
  console.log(`[Stream Video Saver] captureVideoFrame called with maxWidth=${maxWidth}, maxHeight=${maxHeight}`);
  try {
    // First, try to find video elements in the main document
    const videoElements = document.getElementsByTagName('video');
    console.log(`[Stream Video Saver] Found ${videoElements.length} video element(s) in main document`);

    let video: HTMLVideoElement | null = null;

      for (let i = 0; i < videoElements.length; i++) {
      const v = videoElements[i];
      console.log(`[Stream Video Saver] Video element ${i}: readyState=${v.readyState}, videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}, src=${v.src?.substring(0, 100)}`);
      // Check if video is loaded and has dimensions
      if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
        video = v;
        console.log(`[Stream Video Saver] Selected video element ${i} for preview capture`);
        break;
      } else if (v.videoWidth > 0 && v.videoHeight > 0) {
        // Video has dimensions but readyState < 2 - we'll wait for it
        video = v;
        console.log(`[Stream Video Saver] Selected video element ${i} (has dimensions but readyState < 2, will wait)`);
        break;
      } else if (v.src || v.currentSrc) {
        // Video has a source but not loaded yet - we'll try waiting for it
        video = v;
        console.log(`[Stream Video Saver] Selected video element ${i} (has source but not loaded, will wait)`);
        break;
      }
    }

    // If no video found in main document, try searching in iframes
    if (!video) {
      console.log('[Stream Video Saver] No video found in main document, trying iframes...');
      const iframes = document.getElementsByTagName('iframe');
      console.log(`[Stream Video Saver] Found ${iframes.length} iframe(s) on page`);

      for (let i = 0; i < iframes.length; i++) {
        const iframe = iframes[i];
        try {
          // Try to access iframe's contentDocument (may fail due to CORS)
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeVideos = iframeDoc.getElementsByTagName('video');
            console.log(`[Stream Video Saver] Iframe ${i}: Found ${iframeVideos.length} video element(s)`);

            for (let j = 0; j < iframeVideos.length; j++) {
              const v = iframeVideos[j];
              console.log(`[Stream Video Saver] Iframe ${i} video element ${j}: readyState=${v.readyState}, videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}`);
              // Accept video even if not fully loaded - we'll wait for it later
              if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
                video = v;
                console.log(`[Stream Video Saver] Selected video element from iframe ${i}`);
                break;
              } else if (v.videoWidth > 0 && v.videoHeight > 0) {
                // Video has dimensions but readyState < 2 - we'll wait for it
                video = v;
                console.log(`[Stream Video Saver] Selected video element from iframe ${i} (has dimensions but readyState < 2, will wait)`);
                break;
              } else if (v.src || v.currentSrc) {
                // Video has a source but not loaded yet - we'll try waiting for it
                video = v;
                console.log(`[Stream Video Saver] Selected video element from iframe ${i} (has source but not loaded, will wait)`);
                break;
              }
            }
            if (video) break;
          } else {
            console.log(`[Stream Video Saver] Iframe ${i}: Cannot access contentDocument (likely cross-origin)`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`[Stream Video Saver] Iframe ${i}: Error accessing contentDocument: ${errorMessage}`);
        }
      }
    }

    if (!video) {
      console.log('[Stream Video Saver] No video element found in main document or iframes');
      return [];
    }

    // Wait for video to load if it's not ready yet
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      console.log(`[Stream Video Saver] Video not fully loaded yet (readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}), waiting...`);
      try {
        await waitForVideoLoad(video, 3000); // Wait up to 3 seconds
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[Stream Video Saver] Video did not load within timeout: ${errorMessage}`);
        return [];
      }
    }

    // Check if video has duration (needed for seeking)
    if (!video.duration || isNaN(video.duration) || !isFinite(video.duration)) {
      console.log('[Stream Video Saver] Video duration not available, cannot seek to specific timestamps');
      // Fallback to current frame
      const frame = captureFrameAtCurrentTime(video, maxWidth, maxHeight);
      return frame ? [frame] : [];
    }

    // Store original time and muted state to restore later
    const originalTime = video.currentTime;
    const originalMuted = video.muted;
    const previewFrames: string[] = [];

    // Mute video during capture to avoid audio playback
    video.muted = true;

    try {
      // Capture frames at specified timestamps
      for (const timestamp of timestamps) {
        // Clamp timestamp to video duration
        const seekTime = Math.min(Math.max(0, timestamp), video.duration);

        console.log(`[Stream Video Saver] Seeking to ${seekTime}s (duration: ${video.duration}s)`);

        try {
          await waitForVideoSeek(video, seekTime, 2000);
          const frame = captureFrameAtCurrentTime(video, maxWidth, maxHeight);
          if (frame) {
            previewFrames.push(frame);
            console.log(`[Stream Video Saver] Successfully captured frame at ${seekTime}s (${Math.round(frame.length / 1024)}KB)`);
          } else {
            console.log(`[Stream Video Saver] Failed to capture frame at ${seekTime}s`);
          }
        } catch (seekError) {
          const errorMessage = seekError instanceof Error ? seekError.message : String(seekError);
          console.log(`[Stream Video Saver] Error seeking to ${seekTime}s: ${errorMessage}`);
          // Continue with next timestamp
        }
      }

      // Restore original video time and muted state
      try {
        video.currentTime = originalTime;
        // Only restore unmuted state if video was originally unmuted
        // If it was already muted, keep it muted
        if (!originalMuted) {
          video.muted = originalMuted;
        }
      } catch (restoreError) {
        // Ignore restore errors
        console.log('[Stream Video Saver] Could not restore original video time/muted state');
      }

      if (previewFrames.length === 0) {
        console.log('[Stream Video Saver] No frames captured, trying fallback to current frame');
        // Fallback to current frame if no frames captured
        const frame = captureFrameAtCurrentTime(video, maxWidth, maxHeight);
        if (frame) {
          previewFrames.push(frame);
        }
      }

      console.log(`[Stream Video Saver] Captured ${previewFrames.length} preview frame(s)`);
      return previewFrames;
    } catch (error) {
      // CORS or other error - video might be cross-origin
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[Stream Video Saver] Could not capture video frames (likely CORS): ${errorMessage}`);
      return [];
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Stream Video Saver] Error capturing video frame: ${errorMessage}`);
    return [];
  }
}

/**
 * Message listener for title extraction and preview frame requests
 */
chrome.runtime.onMessage.addListener((
  message: { action: string },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: { title?: string | null; previewUrl?: string | null; previewUrls?: string[]; blobUrl?: string; error?: string }) => void
): boolean => {
  if (message.action === 'getVideoTitle') {
    const title = extractVideoTitle();
    sendResponse({ title });
    return true;
  }

  if (message.action === 'getVideoPreview') {
    console.log('[Stream Video Saver] Content script received getVideoPreview message');
    // Use async/await to handle the promise
    captureVideoFrame().then((previewUrls) => {
      if (previewUrls && previewUrls.length > 0) {
        console.log(`[Stream Video Saver] Content script sending ${previewUrls.length} preview URL(s) back (first frame length: ${previewUrls[0].length})`);
      } else {
        console.log('[Stream Video Saver] Content script could not capture preview - returning empty array');
      }
      sendResponse({ previewUrls: previewUrls || [] });
    }).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Stream Video Saver] Error capturing preview: ${errorMessage}`);
      sendResponse({ previewUrls: [] });
    });
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

  return false;
});
