import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, initLogger, setLogLevels, getLogLevels, resetLogLevels } from '../logger';

describe('Logger Utility', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleGroupSpy: ReturnType<typeof vi.spyOn>;
  let consoleGroupCollapsedSpy: ReturnType<typeof vi.spyOn>;
  let consoleGroupEndSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
    consoleGroupCollapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logger.log', () => {
    it('should prefix a simple string message', () => {
      logger.log('Test message');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Test message');
    });

    it('should prefix a message with multiple arguments', () => {
      logger.log('Test message', { data: 123 });
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Test message', { data: 123 });
    });

    it('should not add duplicate prefix if message already has it', () => {
      logger.log('[Stream Video Saver] Already prefixed');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Already prefixed');
    });

    it('should handle non-string first argument by adding prefix as first arg', () => {
      logger.log({ data: 123 }, 'additional');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver]', { data: 123 }, 'additional');
    });

    it('should handle empty arguments by adding only prefix', () => {
      logger.log();
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver]');
    });

    it('should handle template literals correctly', () => {
      const variable = 'test';
      logger.log(`Message with ${variable}`);
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Message with test');
    });
  });

  describe('logger.warn', () => {
    it('should prefix a warning message', () => {
      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('[Stream Video Saver] Warning message');
    });

    it('should prefix a warning with multiple arguments', () => {
      logger.warn('Warning message', { error: 'details' });
      expect(consoleWarnSpy).toHaveBeenCalledWith('[Stream Video Saver] Warning message', { error: 'details' });
    });

    it('should not add duplicate prefix if message already has it', () => {
      logger.warn('[Stream Video Saver] Already prefixed warning');
      expect(consoleWarnSpy).toHaveBeenCalledWith('[Stream Video Saver] Already prefixed warning');
    });
  });

  describe('logger.error', () => {
    it('should prefix an error message', () => {
      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Stream Video Saver] Error message');
    });

    it('should prefix an error with error object', () => {
      const error = new Error('Test error');
      logger.error('Error occurred:', error);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Stream Video Saver] Error occurred:', error);
    });

    it('should not add duplicate prefix if message already has it', () => {
      logger.error('[Stream Video Saver] Already prefixed error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Stream Video Saver] Already prefixed error');
    });
  });

  describe('logger.debug', () => {
    beforeEach(async () => {
      // Enable debug for these tests
      await setLogLevels({ debug: true });
    });

    it('should prefix a debug message', () => {
      logger.debug('Debug message');
      expect(consoleDebugSpy).toHaveBeenCalledWith('[Stream Video Saver] Debug message');
    });

    it('should prefix a debug message with multiple arguments', () => {
      logger.debug('Debug message', { key: 'value' });
      expect(consoleDebugSpy).toHaveBeenCalledWith('[Stream Video Saver] Debug message', { key: 'value' });
    });

    it('should not add duplicate prefix if message already has it', () => {
      logger.debug('[Stream Video Saver] Already prefixed debug');
      expect(consoleDebugSpy).toHaveBeenCalledWith('[Stream Video Saver] Already prefixed debug');
    });
  });

  describe('logger.info', () => {
    it('should prefix an info message', () => {
      logger.info('Info message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('[Stream Video Saver] Info message');
    });

    it('should prefix an info message with multiple arguments', () => {
      logger.info('Info message', { data: 'value' });
      expect(consoleInfoSpy).toHaveBeenCalledWith('[Stream Video Saver] Info message', { data: 'value' });
    });

    it('should not add duplicate prefix if message already has it', () => {
      logger.info('[Stream Video Saver] Already prefixed info');
      expect(consoleInfoSpy).toHaveBeenCalledWith('[Stream Video Saver] Already prefixed info');
    });
  });

  describe('logger.group', () => {
    it('should prefix a group message', () => {
      logger.group('Group message');
      expect(consoleGroupSpy).toHaveBeenCalledWith('[Stream Video Saver] Group message');
    });

    it('should prefix a group message with multiple arguments', () => {
      logger.group('Group message', { data: 'value' });
      expect(consoleGroupSpy).toHaveBeenCalledWith('[Stream Video Saver] Group message', { data: 'value' });
    });

    it('should not add duplicate prefix if message already has it', () => {
      logger.group('[Stream Video Saver] Already prefixed group');
      expect(consoleGroupSpy).toHaveBeenCalledWith('[Stream Video Saver] Already prefixed group');
    });
  });

  describe('logger.groupCollapsed', () => {
    it('should prefix a collapsed group message', () => {
      logger.groupCollapsed('Collapsed group message');
      expect(consoleGroupCollapsedSpy).toHaveBeenCalledWith('[Stream Video Saver] Collapsed group message');
    });

    it('should prefix a collapsed group message with multiple arguments', () => {
      logger.groupCollapsed('Collapsed group message', { data: 'value' });
      expect(consoleGroupCollapsedSpy).toHaveBeenCalledWith('[Stream Video Saver] Collapsed group message', { data: 'value' });
    });

    it('should not add duplicate prefix if message already has it', () => {
      logger.groupCollapsed('[Stream Video Saver] Already prefixed collapsed group');
      expect(consoleGroupCollapsedSpy).toHaveBeenCalledWith('[Stream Video Saver] Already prefixed collapsed group');
    });
  });

  describe('logger.groupEnd', () => {
    it('should call console.groupEnd without arguments', () => {
      logger.groupEnd();
      expect(consoleGroupEndSpy).toHaveBeenCalledWith();
      expect(consoleGroupEndSpy).toHaveBeenCalledTimes(1);
    });

    it('should call console.groupEnd even when called multiple times', () => {
      logger.groupEnd();
      logger.groupEnd();
      expect(consoleGroupEndSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge cases', () => {
    it('should handle null and undefined arguments', () => {
      logger.log(null);
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver]', null);
    });

    it('should handle numbers as first argument', () => {
      logger.log(123, 'additional');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver]', 123, 'additional');
    });

    it('should handle boolean as first argument', () => {
      logger.log(true, 'additional');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver]', true, 'additional');
    });

    it('should handle empty string', () => {
      logger.log('');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] ');
    });

    it('should handle string that starts with prefix but is not exact match', () => {
      logger.log('[Stream Video Saver custom] message');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] [Stream Video Saver custom] message');
    });

    it('should preserve all additional arguments', () => {
      const obj1 = { a: 1 };
      const obj2 = { b: 2 };
      const arr = [1, 2, 3];
      logger.log('Message', obj1, obj2, arr);
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Message', obj1, obj2, arr);
    });
  });

  describe('Real-world usage scenarios', () => {
    it('should handle typical logging scenario', () => {
      logger.log('Background script loaded');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Background script loaded');
    });

    it('should handle error logging with Error object', () => {
      const error = new Error('Failed to fetch');
      logger.error('Error occurred:', error);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Stream Video Saver] Error occurred:', error);
    });

    it('should handle grouped logging', () => {
      logger.groupCollapsed('Processing M3U8: manifest.m3u8');
      logger.log('Content length: 1024 chars');
      logger.log('Content preview: #EXTM3U');
      logger.groupEnd();

      expect(consoleGroupCollapsedSpy).toHaveBeenCalledWith('[Stream Video Saver] Processing M3U8: manifest.m3u8');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Content length: 1024 chars');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Content preview: #EXTM3U');
      expect(consoleGroupEndSpy).toHaveBeenCalled();
    });

    it('should handle template literal with variables', () => {
      const manifestId = 'abc123';
      const count = 5;
      logger.log(`Manifest captured: ${manifestId}. Remaining: ${count}`);
      expect(consoleLogSpy).toHaveBeenCalledWith('[Stream Video Saver] Manifest captured: abc123. Remaining: 5');
    });
  });

  describe('Log level filtering', () => {
    beforeEach(async () => {
      // Reset to default config before each test
      await resetLogLevels();
    });

    it('should hide debug logs by default', async () => {
      await initLogger();
      logger.debug('Debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should show log messages by default', async () => {
      await initLogger();
      logger.log('Log message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should show error messages by default', async () => {
      await initLogger();
      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should show debug logs when enabled', async () => {
      await setLogLevels({ debug: true });
      logger.debug('Debug message');
      expect(consoleDebugSpy).toHaveBeenCalledWith('[Stream Video Saver] Debug message');
    });

    it('should hide log messages when disabled', async () => {
      await setLogLevels({ log: false });
      logger.log('Log message');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should hide info messages when disabled', async () => {
      await setLogLevels({ info: false });
      logger.info('Info message');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('should hide warn messages when disabled', async () => {
      await setLogLevels({ warn: false });
      logger.warn('Warn message');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should hide error messages when disabled', async () => {
      await setLogLevels({ error: false });
      logger.error('Error message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should allow enabling multiple levels at once', async () => {
      await setLogLevels({ debug: true, log: true, info: true });
      logger.debug('Debug message');
      logger.log('Log message');
      logger.info('Info message');
      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('should allow disabling multiple levels at once', async () => {
      await setLogLevels({ log: false, info: false });
      logger.log('Log message');
      logger.info('Info message');
      logger.error('Error message');
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled(); // Error should still work
    });

    it('should get current log level configuration', async () => {
      await initLogger();
      const config = getLogLevels();
      expect(config).toHaveProperty('debug');
      expect(config).toHaveProperty('log');
      expect(config).toHaveProperty('info');
      expect(config).toHaveProperty('warn');
      expect(config).toHaveProperty('error');
      expect(config.debug).toBe(false); // Default should be false
    });

    it('should reset log levels to default', async () => {
      await setLogLevels({ debug: true, log: false });
      await resetLogLevels();
      const config = getLogLevels();
      expect(config.debug).toBe(false);
      expect(config.log).toBe(true);
    });

    it('should work without chrome.storage (fallback to defaults)', () => {
      // Test that logger works even when chrome.storage is unavailable
      // This simulates test environment or when storage API is not available
      logger.debug('Debug message');
      logger.log('Log message');
      expect(consoleDebugSpy).not.toHaveBeenCalled(); // Debug disabled by default
      expect(consoleLogSpy).toHaveBeenCalled(); // Log enabled by default
    });
  });
});
