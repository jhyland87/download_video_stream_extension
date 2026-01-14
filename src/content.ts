/**
 * @fileoverview Content script for extracting video title from the page
 * This script runs in the context of web pages to extract video metadata
 */

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
  const videoElements = document.querySelectorAll('video');
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
 * Message listener for title extraction requests
 */
chrome.runtime.onMessage.addListener((
  message: { action: string },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: { title: string | null }) => void
): boolean => {
  if (message.action === 'getVideoTitle') {
    const title = extractVideoTitle();
    sendResponse({ title });
    return true;
  }
  return false;
});

