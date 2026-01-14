import { describe, it, expect } from 'vitest';
import {
  isMessageAction,
  isGetStatusMessage,
  isGetManifestDataMessage,
  isStartDownloadMessage,
  isCancelDownloadMessage,
  isClearManifestMessage,
  isGetDownloadStatusMessage,
  isDownloadProgressMessage,
  isDownloadErrorMessage,
  isManifestCapturedMessage
} from '../index.js';
import type {
  GetStatusMessage,
  GetManifestDataMessage,
  StartDownloadMessage,
  CancelDownloadMessage,
  ClearManifestMessage,
  GetDownloadStatusMessage,
  DownloadProgressMessage,
  DownloadErrorMessage,
  ManifestCapturedMessage
} from './index.js';

describe('Type guards', () => {
  describe('isMessageAction', () => {
    it('should return true for valid message actions', () => {
      expect(isMessageAction('getStatus')).toBe(true);
      expect(isMessageAction('startDownload')).toBe(true);
      expect(isMessageAction('cancelDownload')).toBe(true);
    });

    it('should return false for invalid message actions', () => {
      expect(isMessageAction('invalidAction')).toBe(false);
      expect(isMessageAction(123)).toBe(false);
      expect(isMessageAction(null)).toBe(false);
      expect(isMessageAction(undefined)).toBe(false);
    });
  });

  describe('isGetStatusMessage', () => {
    it('should return true for valid GetStatusMessage', () => {
      const message: GetStatusMessage = { action: 'getStatus' };
      expect(isGetStatusMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isGetStatusMessage({ action: 'invalid' })).toBe(false);
      expect(isGetStatusMessage(null)).toBe(false);
      expect(isGetStatusMessage(undefined)).toBe(false);
    });
  });

  describe('isGetManifestDataMessage', () => {
    it('should return true for valid GetManifestDataMessage', () => {
      const message: GetManifestDataMessage = {
        action: 'getManifestData',
        manifestId: 'test-id'
      };
      expect(isGetManifestDataMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isGetManifestDataMessage({ action: 'getManifestData' })).toBe(false);
      expect(isGetManifestDataMessage({ action: 'getManifestData', manifestId: 123 })).toBe(false);
    });
  });

  describe('isStartDownloadMessage', () => {
    it('should return true for valid StartDownloadMessage', () => {
      const message: StartDownloadMessage = {
        action: 'startDownload',
        manifestId: 'test-id',
        format: 'zip'
      };
      expect(isStartDownloadMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isStartDownloadMessage({ action: 'startDownload', manifestId: 'test', format: 'invalid' })).toBe(false);
      expect(isStartDownloadMessage({ action: 'startDownload' })).toBe(false);
    });
  });

  describe('isCancelDownloadMessage', () => {
    it('should return true for valid CancelDownloadMessage', () => {
      const message: CancelDownloadMessage = {
        action: 'cancelDownload',
        downloadId: 'test-id'
      };
      expect(isCancelDownloadMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isCancelDownloadMessage({ action: 'cancelDownload' })).toBe(false);
    });
  });

  describe('isClearManifestMessage', () => {
    it('should return true for valid ClearManifestMessage', () => {
      const message: ClearManifestMessage = { action: 'clearManifest' };
      expect(isClearManifestMessage(message)).toBe(true);
      const messageWithId: ClearManifestMessage = { action: 'clearManifest', manifestId: 'test-id' };
      expect(isClearManifestMessage(messageWithId)).toBe(true);
    });
  });

  describe('isGetDownloadStatusMessage', () => {
    it('should return true for valid GetDownloadStatusMessage', () => {
      const message: GetDownloadStatusMessage = { action: 'getDownloadStatus' };
      expect(isGetDownloadStatusMessage(message)).toBe(true);
    });
  });

  describe('isDownloadProgressMessage', () => {
    it('should return true for valid DownloadProgressMessage', () => {
      const message: DownloadProgressMessage = {
        action: 'downloadProgress',
        downloadId: 'test-id',
        downloaded: 5,
        total: 10,
        status: 'downloading'
      };
      expect(isDownloadProgressMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isDownloadProgressMessage({ action: 'downloadProgress' })).toBe(false);
      expect(isDownloadProgressMessage({ action: 'downloadProgress', downloadId: 'test', downloaded: '5', total: 10, status: 'downloading' })).toBe(false);
    });
  });

  describe('isDownloadErrorMessage', () => {
    it('should return true for valid DownloadErrorMessage', () => {
      const message: DownloadErrorMessage = {
        action: 'downloadError',
        downloadId: 'test-id',
        error: 'Test error'
      };
      expect(isDownloadErrorMessage(message)).toBe(true);
    });
  });

  describe('isManifestCapturedMessage', () => {
    it('should return true for valid ManifestCapturedMessage', () => {
      const message: ManifestCapturedMessage = {
        action: 'manifestCaptured',
        manifestId: 'test-id',
        fileName: 'test.m3u8',
        segmentCount: 10
      };
      expect(isManifestCapturedMessage(message)).toBe(true);
    });
  });
});

