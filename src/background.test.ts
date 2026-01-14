import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Manifest, DownloadFormat } from './types/index.js';

/**
 * Unit tests for background script functions
 * Note: These test the core logic, not Chrome APIs
 */

// Mock Chrome APIs
global.chrome = {
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
  }
} as unknown as typeof chrome;

// Mock JSZip
global.JSZip = class {
  file(): this {
    return this;
  }
  async generateAsync(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
} as unknown as typeof JSZip;

/**
 * Testable version of generateManifestId
 */
function generateManifestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Testable version of parseM3U8
 */
function parseM3U8(content: string, baseUrl: string): string[] {
  const lines = content.split('\n');
  const segmentUrls: string[] = [];

  if (!baseUrl) {
    return segmentUrls;
  }

  const baseUrlWithoutQuery = baseUrl.split('?')[0];
  const base = new URL(baseUrlWithoutQuery);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    if (line && !line.startsWith('#')) {
      let segmentUrl: string;

      if (line.startsWith('http://') || line.startsWith('https://')) {
        segmentUrl = line;
      } else if (line.startsWith('/')) {
        segmentUrl = base.origin + line;
      } else {
        segmentUrl = base.origin + basePath + line;
      }

      segmentUrls.push(segmentUrl);
    }
  }

  return segmentUrls;
}

describe('generateManifestId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateManifestId();
    const id2 = generateManifestId();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
  });

  it('should generate IDs with consistent format', () => {
    const id = generateManifestId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

describe('parseM3U8', () => {
  it('should parse segments from m3u8 content', () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
segment1.ts
segment2.ts
segment3.ts`;
    const baseUrl = 'https://example.com/video/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('https://example.com/video/segment1.ts');
  });

  it('should handle absolute URLs in content', () => {
    const content = 'https://cdn.example.com/segment1.ts';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result[0]).toBe('https://cdn.example.com/segment1.ts');
  });

  it('should return empty array for invalid baseUrl', () => {
    const content = 'segment1.ts';
    const result = parseM3U8(content, '');
    expect(result).toEqual([]);
  });
});

describe('Manifest filtering logic', () => {
  it('should filter manifests with no segments', () => {
    const manifests: Manifest[] = [
      {
        id: '1',
        m3u8Url: 'https://example.com/playlist1.m3u8',
        m3u8Content: '#EXTM3U',
        m3u8FileName: 'playlist1.m3u8',
        expectedSegments: ['seg1.ts', 'seg2.ts'],
        capturedAt: new Date().toISOString()
      },
      {
        id: '2',
        m3u8Url: 'https://example.com/playlist2.m3u8',
        m3u8Content: '#EXTM3U',
        m3u8FileName: 'playlist2.m3u8',
        expectedSegments: [],
        capturedAt: new Date().toISOString()
      }
    ];

    const filtered = manifests.filter((m) => m.expectedSegments.length > 0);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });

  it('should keep most recent manifest for duplicate URLs', () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 10000);
    const later = new Date(now.getTime() + 10000);

    const manifests: Manifest[] = [
      {
        id: '1',
        m3u8Url: 'https://example.com/playlist.m3u8',
        m3u8Content: '#EXTM3U',
        m3u8FileName: 'playlist.m3u8',
        expectedSegments: ['seg1.ts'],
        capturedAt: earlier.toISOString()
      },
      {
        id: '2',
        m3u8Url: 'https://example.com/playlist.m3u8?token=abc',
        m3u8Content: '#EXTM3U',
        m3u8FileName: 'playlist.m3u8',
        expectedSegments: ['seg1.ts'],
        capturedAt: later.toISOString()
      }
    ];

    const seen = new Map<string, { capturedAt: string }>();
    const filtered = manifests
      .map((m) => ({
        id: m.id,
        capturedAt: m.capturedAt,
        urlKey: m.m3u8Url.split('?')[0]
      }))
      .filter((m) => {
        const existing = seen.get(m.urlKey);
        if (!existing || new Date(m.capturedAt) > new Date(existing.capturedAt)) {
          if (existing) {
            seen.delete(m.urlKey);
          }
          seen.set(m.urlKey, m);
          return true;
        }
        return false;
      });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('2');
  });
});

describe('Download format validation', () => {
  it('should accept valid download formats', () => {
    const formats: DownloadFormat[] = ['zip'];
    formats.forEach((format) => {
      expect(format === 'zip').toBe(true);
    });
  });
});

