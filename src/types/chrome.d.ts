/**
 * Chrome Extension API type definitions
 * Extends the chrome types with our specific usage patterns
 */

/// <reference types="chrome"/>

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: chrome.tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
      tlsChannelId?: string;
      origin?: string;
    }
  }

  namespace downloads {
    interface DownloadOptions {
      url: string;
      filename?: string;
      saveAs?: boolean;
      conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
    }

    type DownloadCallback = (downloadId?: number) => void;
  }
}

