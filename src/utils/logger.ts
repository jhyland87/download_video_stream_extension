/**
 * @fileoverview Logger utility for consistent console logging with extension name prefix.
 * All console methods are wrapped to automatically prefix messages with "[Stream Video Saver]".
 * Supports filtering log levels via configuration stored in chrome.storage.local.
 */

import type { LogLevel, LogLevelConfig } from '../types';

const EXTENSION_NAME = '[Stream Video Saver]';
const STORAGE_KEY = 'loggerConfig';

/**
 * Default log level configuration (debug hidden by default)
 */
const DEFAULT_CONFIG: LogLevelConfig = {
  debug: false,
  log: true,
  info: true,
  warn: true,
  error: true
};

/**
 * Current log level configuration (cached in memory)
 */
let currentConfig: LogLevelConfig = { ...DEFAULT_CONFIG };
let configLoaded = false;

/**
 * Loads log level configuration from chrome.storage.local.
 * Falls back to default config if storage is unavailable or unset.
 */
async function loadConfig(): Promise<void> {
  if (configLoaded) {
    return;
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        currentConfig = { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] };
      }
    }
  } catch (error) {
    // If storage is unavailable (e.g., in tests), use default config
    currentConfig = { ...DEFAULT_CONFIG };
  }
  configLoaded = true;
}

/**
 * Checks if a log level is enabled.
 * @param level - The log level to check
 * @returns true if the level is enabled, false otherwise
 */
function isLevelEnabled(level: LogLevel): boolean {
  // Load config synchronously if not loaded (for immediate use)
  // In practice, config will be loaded before first use via initLogger()
  return currentConfig[level] ?? DEFAULT_CONFIG[level];
}

/**
 * Formats a message by prepending the extension name.
 * @param args - Arguments to format (first should be a string message)
 * @returns Formatted arguments with extension name prefix
 */
function formatMessage(...args: unknown[]): unknown[] {
  if (args.length === 0) {
    return [EXTENSION_NAME];
  }

  const firstArg = args[0];
  // If the first argument is already a string with the prefix, don't add it again
  if (typeof firstArg === 'string' && firstArg.startsWith(EXTENSION_NAME)) {
    return args;
  }

  // If the first argument is a string, prepend the extension name
  if (typeof firstArg === 'string') {
    return [`${EXTENSION_NAME} ${firstArg}`, ...args.slice(1)];
  }

  // Otherwise, add the extension name as the first argument
  return [EXTENSION_NAME, ...args];
}

/**
 * Wrapped console object with automatic extension name prefixing and log level filtering.
 * All methods preserve their original functionality while adding the prefix and checking if the level is enabled.
 */
export const logger = {
  log: (...args: unknown[]): void => {
    if (isLevelEnabled('log')) {
      console.log(...formatMessage(...args));
    }
  },

  warn: (...args: unknown[]): void => {
    if (isLevelEnabled('warn')) {
      console.warn(...formatMessage(...args));
    }
  },

  error: (...args: unknown[]): void => {
    if (isLevelEnabled('error')) {
      console.error(...formatMessage(...args));
    }
  },

  debug: (...args: unknown[]): void => {
    if (isLevelEnabled('debug')) {
      console.debug(...formatMessage(...args));
    }
  },

  info: (...args: unknown[]): void => {
    if (isLevelEnabled('info')) {
      console.info(...formatMessage(...args));
    }
  },

  group: (...args: unknown[]): void => {
    console.group(...formatMessage(...args));
  },

  groupCollapsed: (...args: unknown[]): void => {
    console.groupCollapsed(...formatMessage(...args));
  },

  groupEnd: (): void => {
    console.groupEnd();
  }
};

/**
 * Initializes the logger by loading configuration from storage.
 * Should be called early in the application lifecycle.
 */
export async function initLogger(): Promise<void> {
  await loadConfig();
}

/**
 * Sets the log level configuration and saves it to storage.
 * @param config - Partial log level configuration (only specified levels will be updated)
 */
export async function setLogLevels(config: Partial<LogLevelConfig>): Promise<void> {
  currentConfig = { ...currentConfig, ...config };
  configLoaded = true;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: currentConfig });
    }
  } catch (error) {
    // If storage is unavailable, just update in-memory config
  }
}

/**
 * Gets the current log level configuration.
 * @returns Current log level configuration
 */
export function getLogLevels(): LogLevelConfig {
  return { ...currentConfig };
}

/**
 * Resets log levels to default configuration.
 */
export async function resetLogLevels(): Promise<void> {
  await setLogLevels(DEFAULT_CONFIG);
}
