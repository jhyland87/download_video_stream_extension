"use strict";
var ContentScript = (() => {
  // src/content.ts
  function extractVideoTitle() {
    const videoElements = document.querySelectorAll("video");
    for (let i = 0; i < videoElements.length; i++) {
      const video = videoElements[i];
      if (video.title) {
        return video.title.trim();
      }
      const ariaLabel = video.getAttribute("aria-label");
      if (ariaLabel) {
        return ariaLabel.trim();
      }
    }
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      const content = ogTitle.getAttribute("content");
      if (content) {
        return content.trim();
      }
    }
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) {
      const content = twitterTitle.getAttribute("content");
      if (content) {
        return content.trim();
      }
    }
    const videoTitle = document.querySelector('meta[property="video:title"]');
    if (videoTitle) {
      const content = videoTitle.getAttribute("content");
      if (content) {
        return content.trim();
      }
    }
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent) {
      const text = h1.textContent.trim();
      if (text && text.length > 0 && text.length < 200) {
        return text;
      }
    }
    return null;
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "getVideoTitle") {
      const title = extractVideoTitle();
      sendResponse({ title });
      return true;
    }
    return false;
  });
})();
//# sourceMappingURL=content.js.map
