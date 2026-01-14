import { describe, it, expect } from 'vitest';

/**
 * Test utilities for m3u8 parsing functions
 * These functions are extracted for testing purposes
 */

/**
 * Parses an m3u8 playlist file and extracts segment URLs.
 * This is a testable version of the parseM3U8 function.
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

/**
 * Modifies m3u8 content to use local filenames instead of full URLs.
 * This is a testable version of the modifyM3U8ForLocalFiles function.
 */
function modifyM3U8ForLocalFiles(content: string, baseUrl: string): string {
  const lines = content.split('\n');
  const modifiedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      modifiedLines.push(line);
      continue;
    }

    try {
      let filename: string;

      if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
        const url = new URL(trimmedLine);
        const pathParts = url.pathname.split('/');
        filename = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'segment.ts';
      } else if (trimmedLine.startsWith('/')) {
        const pathParts = trimmedLine.split('/');
        filename = pathParts[pathParts.length - 1] || 'segment.ts';
      } else {
        const urlParts = trimmedLine.split('?')[0].split('/');
        filename = urlParts[urlParts.length - 1] || 'segment.ts';
      }

      if (!filename) {
        modifiedLines.push(line);
        continue;
      }

      filename = filename.split('?')[0];
      modifiedLines.push(filename);
    } catch {
      modifiedLines.push(line);
    }
  }

  return modifiedLines.join('\n');
}

describe('parseM3U8', () => {
  it('should parse absolute URLs', () => {
    const content = 'https://example.com/segment1.ts\nhttps://example.com/segment2.ts';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result).toEqual([
      'https://example.com/segment1.ts',
      'https://example.com/segment2.ts'
    ]);
  });

  it('should parse relative URLs', () => {
    const content = 'segment1.ts\nsegment2.ts';
    const baseUrl = 'https://example.com/video/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result).toEqual([
      'https://example.com/video/segment1.ts',
      'https://example.com/video/segment2.ts'
    ]);
  });

  it('should parse absolute path URLs', () => {
    const content = '/video/segment1.ts\n/video/segment2.ts';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result).toEqual([
      'https://example.com/video/segment1.ts',
      'https://example.com/video/segment2.ts'
    ]);
  });

  it('should skip comments and empty lines', () => {
    const content = '#EXTM3U\n#EXT-X-VERSION:3\n\nsegment1.ts\n# Comment\nsegment2.ts';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result).toEqual([
      'https://example.com/segment1.ts',
      'https://example.com/segment2.ts'
    ]);
  });

  it('should return empty array for empty content', () => {
    const content = '';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result).toEqual([]);
  });

  it('should return empty array when baseUrl is missing', () => {
    const content = 'segment1.ts';
    const baseUrl = '';
    const result = parseM3U8(content, baseUrl);
    expect(result).toEqual([]);
  });

  it('should handle URLs with query parameters', () => {
    const content = 'segment1.ts?token=abc123';
    const baseUrl = 'https://example.com/video/playlist.m3u8';
    const result = parseM3U8(content, baseUrl);
    expect(result).toEqual(['https://example.com/video/segment1.ts?token=abc123']);
  });
});

describe('modifyM3U8ForLocalFiles', () => {
  it('should extract filenames from absolute URLs', () => {
    const content = 'https://example.com/video/segment1.ts\nhttps://example.com/video/segment2.ts';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = modifyM3U8ForLocalFiles(content, baseUrl);
    expect(result).toContain('segment1.ts');
    expect(result).toContain('segment2.ts');
    expect(result).not.toContain('https://example.com');
  });

  it('should preserve comments and metadata', () => {
    const content = '#EXTM3U\n#EXT-X-VERSION:3\nsegment1.ts';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = modifyM3U8ForLocalFiles(content, baseUrl);
    expect(result).toContain('#EXTM3U');
    expect(result).toContain('#EXT-X-VERSION:3');
    expect(result).toContain('segment1.ts');
  });

  it('should handle relative paths', () => {
    const content = '../segments/segment1.ts';
    const baseUrl = 'https://example.com/video/playlist.m3u8';
    const result = modifyM3U8ForLocalFiles(content, baseUrl);
    expect(result).toContain('segment1.ts');
  });

  it('should handle URLs with query parameters', () => {
    const content = 'https://example.com/segment1.ts?token=abc&expires=123';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = modifyM3U8ForLocalFiles(content, baseUrl);
    expect(result).toContain('segment1.ts');
    expect(result).not.toContain('?token=');
  });

  it('should preserve empty lines', () => {
    const content = 'segment1.ts\n\nsegment2.ts';
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = modifyM3U8ForLocalFiles(content, baseUrl);
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(2);
  });
});

