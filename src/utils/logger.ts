/**
 * @fileoverview Logger utility for consistent console logging with extension name prefix.
 * All console methods are wrapped to automatically prefix messages with "[Stream Video Saver]".
 */

const EXTENSION_NAME = '[Stream Video Saver]';

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
 * Wrapped console object with automatic extension name prefixing.
 * All methods preserve their original functionality while adding the prefix.
 */
export const logger = {
  log: (...args: unknown[]): void => {
    console.log(...formatMessage(...args));
  },

  warn: (...args: unknown[]): void => {
    console.warn(...formatMessage(...args));
  },

  error: (...args: unknown[]): void => {
    console.error(...formatMessage(...args));
  },

  debug: (...args: unknown[]): void => {
    console.debug(...formatMessage(...args));
  },

  info: (...args: unknown[]): void => {
    console.info(...formatMessage(...args));
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
