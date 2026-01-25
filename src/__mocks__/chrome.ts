import { vi } from 'vitest';

/**
 * Mock storage for session storage
 */
export const mockStorageSession: Record<string, unknown> = {};

/**
 * Mock storage for local storage
 */
export const mockStorageLocal: Record<string, unknown> = {};

/**
 * Mock Chrome APIs
 */
export const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn()
    },
    lastError: undefined
  },
  webRequest: {
    onCompleted: {
      addListener: vi.fn()
    }
  },
  downloads: {
    download: vi.fn()
  },
  storage: {
    session: {
      get: vi.fn((keys: string | string[] | Record<string, unknown> | null) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockStorageSession[keys] || [] });
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            result[key] = mockStorageSession[key] || [];
          }
          return Promise.resolve(result);
        }
        return Promise.resolve({});
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorageSession, items);
        return Promise.resolve();
      })
    },
    local: {
      get: vi.fn((keys: string | string[] | Record<string, unknown> | null) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockStorageLocal[keys] || [] });
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            result[key] = mockStorageLocal[key] || [];
          }
          return Promise.resolve(result);
        }
        return Promise.resolve({});
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorageLocal, items);
        return Promise.resolve();
      })
    }
  },
  windows: {
    getCurrent: vi.fn(() => Promise.resolve({ id: 1 } as chrome.windows.Window))
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([{ id: 100, windowId: 1 } as chrome.tabs.Tab])),
    get: vi.fn(() => Promise.resolve({ id: 100, windowId: 1 } as chrome.tabs.Tab)),
    sendMessage: vi.fn()
  },
  action: {
    setBadgeText: vi.fn(() => Promise.resolve()),
    setBadgeBackgroundColor: vi.fn(() => Promise.resolve())
  }
} as unknown as typeof chrome;

/**
 * Setup Chrome mock globally
 */
export function setupChromeMock(): void {
  global.chrome = mockChrome;
}

/**
 * Clear Chrome mock storage
 */
export function clearChromeStorage(): void {
  Object.keys(mockStorageSession).forEach(key => delete mockStorageSession[key]);
  Object.keys(mockStorageLocal).forEach(key => delete mockStorageLocal[key]);
}
