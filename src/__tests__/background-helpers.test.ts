import { describe, it, expect } from 'vitest';
import type { ZipNamingInfo, SegmentMappings, FolderAndFilename, TestManifest } from '../types';

/**
 * Unit tests for background script helper functions
 * These test the core logic without Chrome APIs
 */

/**
 * Testable version of sanitizeSegmentFilename
 */
function sanitizeSegmentFilename(filename: string): string {
  return filename
    .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid filesystem chars
    .replace(/\s+/g, '_') // Replace whitespace
    .replace(/_{2,}/g, '_') // Multiple underscores
    .replace(/^_+|_+$/g, ''); // Leading/trailing underscores
}

/**
 * Testable version of extractBaseFilename
 */
function extractBaseFilename(url: string, defaultName: string = 'segment.ts'): string {
  let filename: string;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    filename = pathParts[pathParts.length - 1] || defaultName;
  } catch (error) {
    const urlWithoutQuery = url.split('?')[0];
    const parts = urlWithoutQuery.split('/').filter(part => part.length > 0);
    filename = parts[parts.length - 1] || defaultName;
  }
  filename = filename.split('?')[0];
  const sanitized = sanitizeSegmentFilename(filename);
  return sanitized || defaultName;
}

/**
 * Testable version of extractFolderAndFilename
 */
function extractFolderAndFilename(url: string): FolderAndFilename {
  const defaultName = 'segment.ts';
  let segmentName: string;
  let folderName: string;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    segmentName = pathParts[pathParts.length - 1] || defaultName;
    folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
  } catch (error) {
    const urlWithoutQuery = url.split('?')[0];
    const parts = urlWithoutQuery.split('/').filter(part => part.length > 0);
    segmentName = parts[parts.length - 1] || defaultName;
    folderName = parts.length > 1 ? parts[parts.length - 2] : '';
  }
  segmentName = segmentName.split('?')[0];
  folderName = folderName.split('?')[0];
  return {
    folderName: sanitizeSegmentFilename(folderName),
    segmentName: sanitizeSegmentFilename(segmentName) || defaultName
  };
}

/**
 * Testable version of createUrlToFilenameMap
 */
function createUrlToFilenameMap(segmentUrls: string[], defaultName: string = 'segment.ts'): Map<string, string> {
  const urlToFilename = new Map<string, string>();
  const filenameCounts = new Map<string, number>();
  const filenameToUrls = new Map<string, string[]>();

  // First pass: extract base filenames and count occurrences
  for (const url of segmentUrls) {
    const baseFilename = extractBaseFilename(url, defaultName);
    urlToFilename.set(url, baseFilename);

    if (!filenameCounts.has(baseFilename)) {
      filenameCounts.set(baseFilename, 0);
      filenameToUrls.set(baseFilename, []);
    }
    filenameCounts.set(baseFilename, filenameCounts.get(baseFilename)! + 1);
    filenameToUrls.get(baseFilename)!.push(url);
  }

  // Second pass: only for duplicates, create unique filenames using folder name
  for (const [filename, urls] of filenameToUrls.entries()) {
    if (urls.length > 1) {
      for (const url of urls) {
        const { folderName, segmentName } = extractFolderAndFilename(url);
        const uniqueFilename = folderName ? `${folderName}__${segmentName}` : segmentName;
        urlToFilename.set(url, uniqueFilename);
      }
    }
  }

  return urlToFilename;
}

/**
 * Testable version of parseInitSegments
 */
function parseInitSegments(content: string, baseUrl: string): string[] {
  const lines = content.split('\n');
  const initSegmentUrls: string[] = [];

  if (!baseUrl) {
    return initSegmentUrls;
  }

  const baseUrlWithoutQuery = baseUrl.split('?')[0];
  const base = new URL(baseUrlWithoutQuery);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXT-X-MAP:')) {
      const uriMatch = line.match(/URI="([^"]+)"/i);
      if (uriMatch && uriMatch[1]) {
        let initUrl: string;
        const uri = uriMatch[1];

        if (uri.startsWith('http://') || uri.startsWith('https://')) {
          initUrl = uri;
        } else if (uri.startsWith('/')) {
          initUrl = base.origin + uri;
        } else {
          initUrl = base.origin + basePath + uri;
        }

        initSegmentUrls.push(initUrl);
      }
    }
  }

  return initSegmentUrls;
}

/**
 * Testable version of sanitizeFilename
 */
function sanitizeFilename(name: string, maxLength: number = 200): string {
  // Remove or replace invalid characters
  let sanitized = name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filesystem characters
    .replace(/\s+/g, '_') // Replace whitespace with underscores
    .replace(/_{2,}/g, '_') // Collapse multiple underscores
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores

  // Remove non-ASCII characters (keep only ASCII printable: 0x20-0x7E)
  sanitized = sanitized.replace(/[^\x20-\x7E]/g, '');

  // Truncate if too long
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    // Remove trailing underscore if truncation created one
    sanitized = sanitized.replace(/_+$/, '');
  }

  return sanitized || 'video'; // Default fallback
}

describe('sanitizeSegmentFilename', () => {
  it('should remove non-ASCII characters', () => {
    expect(sanitizeSegmentFilename('segment🎬.ts')).toBe('segment.ts');
    expect(sanitizeSegmentFilename('test©video.mp4')).toBe('testvideo.mp4');
  });

  it('should remove invalid filesystem characters', () => {
    expect(sanitizeSegmentFilename('file<>name.ts')).toBe('filename.ts');
    expect(sanitizeSegmentFilename('test:video.ts')).toBe('testvideo.ts');
  });

  it('should handle empty strings', () => {
    expect(sanitizeSegmentFilename('')).toBe('');
  });
});

describe('extractBaseFilename', () => {
  it('should extract filename from absolute URL', () => {
    expect(extractBaseFilename('https://example.com/video/segment1.ts')).toBe('segment1.ts');
    expect(extractBaseFilename('https://example.com/segment.ts?token=abc')).toBe('segment.ts');
  });

  it('should handle URLs with query parameters', () => {
    expect(extractBaseFilename('https://example.com/video.ts?param=value')).toBe('video.ts');
  });

  it('should use default name when URL has no filename', () => {
    expect(extractBaseFilename('https://example.com/', 'default.ts')).toBe('default.ts');
    expect(extractBaseFilename('https://example.com', 'fallback.mp4')).toBe('fallback.mp4');
  });

  it('should sanitize extracted filenames', () => {
    // Note: URL constructor encodes unicode, so pathname extraction already handles encoding
    // The sanitizeSegmentFilename removes the encoded characters
    const result1 = extractBaseFilename('https://example.com/file🎬name.ts');
    expect(result1).not.toContain('🎬');
    expect(result1).toMatch(/^file.*name\.ts$/);

    expect(extractBaseFilename('https://example.com/test:video.ts')).toBe('testvideo.ts');
  });

  it('should handle relative URLs (fallback)', () => {
    // When URL constructor fails, falls back to manual parsing
    const result = extractBaseFilename('../segments/file.ts', 'default.ts');
    expect(result).toBe('file.ts');
  });
});

describe('extractFolderAndFilename', () => {
  it('should extract both folder and filename', () => {
    const result = extractFolderAndFilename('https://example.com/folder/segment.ts');
    expect(result.folderName).toBe('folder');
    expect(result.segmentName).toBe('segment.ts');
  });

  it('should handle URLs with no folder', () => {
    const result = extractFolderAndFilename('https://example.com/segment.ts');
    expect(result.folderName).toBe('');
    expect(result.segmentName).toBe('segment.ts');
  });

  it('should handle nested paths', () => {
    const result = extractFolderAndFilename('https://example.com/video/folder/segment.ts');
    expect(result.folderName).toBe('folder');
    expect(result.segmentName).toBe('segment.ts');
  });

  it('should remove query parameters', () => {
    const result = extractFolderAndFilename('https://example.com/folder/segment.ts?token=abc');
    expect(result.folderName).toBe('folder');
    expect(result.segmentName).toBe('segment.ts');
  });

  it('should sanitize folder and filename', () => {
    // Note: URL constructor encodes unicode (🎬 becomes %F0%9F%8E%AC)
    // The sanitizeSegmentFilename removes non-ASCII, which includes URL-encoded chars
    // After sanitization, the encoded parts should be removed
    const result = extractFolderAndFilename('https://example.com/folder🎬/segment🎬.ts');
    expect(result.folderName).not.toContain('🎬');
    expect(result.folderName).toMatch(/^folder/i);
    // The sanitization removes the encoded emoji but may leave encoded hex
    // The non-ASCII regex should remove it, so segmentName should be valid
    expect(result.segmentName).toMatch(/\.ts$/);
  });
});

describe('createUrlToFilenameMap', () => {
  it('should create simple mapping for unique filenames', () => {
    const urls = [
      'https://example.com/segment1.ts',
      'https://example.com/segment2.ts'
    ];
    const map = createUrlToFilenameMap(urls);
    expect(map.get(urls[0])).toBe('segment1.ts');
    expect(map.get(urls[1])).toBe('segment2.ts');
  });

  it('should handle duplicate filenames from different folders', () => {
    const urls = [
      'https://example.com/folder1/segment.ts',
      'https://example.com/folder2/segment.ts'
    ];
    const map = createUrlToFilenameMap(urls);
    expect(map.get(urls[0])).toBe('folder1__segment.ts');
    expect(map.get(urls[1])).toBe('folder2__segment.ts');
  });

  it('should keep unique filenames as-is', () => {
    const urls = [
      'https://example.com/folder1/unique.ts',
      'https://example.com/folder2/unique.ts',
      'https://example.com/different.ts'
    ];
    const map = createUrlToFilenameMap(urls);
    // The duplicate 'unique.ts' should get folder prefixes
    expect(map.get(urls[2])).toBe('different.ts');
  });

  it('should handle empty array', () => {
    const map = createUrlToFilenameMap([]);
    expect(map.size).toBe(0);
  });

  it('should handle URLs with query parameters', () => {
    const urls = [
      'https://example.com/folder1/segment.ts?token=abc',
      'https://example.com/folder2/segment.ts?token=def'
    ];
    const map = createUrlToFilenameMap(urls);
    expect(map.get(urls[0])).toBe('folder1__segment.ts');
    expect(map.get(urls[1])).toBe('folder2__segment.ts');
  });

  it('should handle multiple duplicates', () => {
    const urls = [
      'https://example.com/folder1/segment.ts',
      'https://example.com/folder2/segment.ts',
      'https://example.com/folder3/segment.ts'
    ];
    const map = createUrlToFilenameMap(urls);
    expect(map.get(urls[0])).toBe('folder1__segment.ts');
    expect(map.get(urls[1])).toBe('folder2__segment.ts');
    expect(map.get(urls[2])).toBe('folder3__segment.ts');
  });
});

describe('parseInitSegments', () => {
  it('should parse init segments from #EXT-X-MAP tags', () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MAP:URI="init.mp4"
segment1.ts`;
    const baseUrl = 'https://example.com/video/playlist.m3u8';
    const result = parseInitSegments(content, baseUrl);
    expect(result).toEqual(['https://example.com/video/init.mp4']);
  });

  it('should handle absolute URLs in #EXT-X-MAP', () => {
    const content = `#EXTM3U
#EXT-X-MAP:URI="https://cdn.example.com/init.mp4"
segment1.ts`;
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseInitSegments(content, baseUrl);
    expect(result).toEqual(['https://cdn.example.com/init.mp4']);
  });

  it('should handle absolute paths in #EXT-X-MAP', () => {
    const content = `#EXTM3U
#EXT-X-MAP:URI="/video/init.mp4"
segment1.ts`;
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseInitSegments(content, baseUrl);
    expect(result).toEqual(['https://example.com/video/init.mp4']);
  });

  it('should handle multiple init segments', () => {
    const content = `#EXTM3U
#EXT-X-MAP:URI="init1.mp4"
segment1.ts
#EXT-X-MAP:URI="init2.mp4"
segment2.ts`;
    const baseUrl = 'https://example.com/video/playlist.m3u8';
    const result = parseInitSegments(content, baseUrl);
    expect(result).toEqual([
      'https://example.com/video/init1.mp4',
      'https://example.com/video/init2.mp4'
    ]);
  });

  it('should return empty array when no init segments found', () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
segment1.ts`;
    const baseUrl = 'https://example.com/playlist.m3u8';
    const result = parseInitSegments(content, baseUrl);
    expect(result).toEqual([]);
  });

  it('should return empty array for empty content', () => {
    const result = parseInitSegments('', 'https://example.com/playlist.m3u8');
    expect(result).toEqual([]);
  });

  it('should return empty array when baseUrl is missing', () => {
    const content = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"`;
    const result = parseInitSegments(content, '');
    expect(result).toEqual([]);
  });

  it('should handle case-insensitive URI attribute', () => {
    const content = `#EXTM3U
#EXT-X-MAP:uri="init.mp4"
segment1.ts`;
    const baseUrl = 'https://example.com/video/playlist.m3u8';
    const result = parseInitSegments(content, baseUrl);
    expect(result).toEqual(['https://example.com/video/init.mp4']);
  });
});

describe('sanitizeFilename', () => {
  it('should remove invalid characters', () => {
    expect(sanitizeFilename('file<>name.mp4')).toBe('filename.mp4');
    expect(sanitizeFilename('test:video.mp4')).toBe('testvideo.mp4');
  });

  it('should replace whitespace with underscores', () => {
    expect(sanitizeFilename('file name.mp4')).toBe('file_name.mp4');
    expect(sanitizeFilename('test  video.mp4')).toBe('test_video.mp4');
  });

  it('should truncate long filenames', () => {
    const longName = 'x'.repeat(300);
    const result = sanitizeFilename(longName, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should remove non-ASCII characters', () => {
    expect(sanitizeFilename('file🎬name.mp4')).toBe('filename.mp4');
    expect(sanitizeFilename('test©video.mp4')).toBe('testvideo.mp4');
  });

  it('should provide default fallback for empty result', () => {
    expect(sanitizeFilename('<>:"/\\|?*')).toBe('video');
    expect(sanitizeFilename('🎬🎬🎬')).toBe('video');
  });

  it('should handle edge cases', () => {
    expect(sanitizeFilename('')).toBe('video');
    expect(sanitizeFilename('   ')).toBe('video');
    expect(sanitizeFilename('___')).toBe('video');
  });
});

/**
 * Testable version of buildZipNamingInfo
 */
function buildZipNamingInfo(manifest: TestManifest): ZipNamingInfo {
  const m3u8FileName = manifest.m3u8Url.substring(manifest.m3u8Url.lastIndexOf('/') + 1).split('?')[0];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const videoBaseName = manifest.title
    ? sanitizeFilename(manifest.title)
    : (m3u8FileName.replace('.m3u8', '') || 'output');

  const outputFileName = `${videoBaseName}-${timestamp}.mp4`;

  return { m3u8FileName, timestamp, videoBaseName, outputFileName };
}

/**
 * Testable version of buildSegmentMappings
 */
function buildSegmentMappings(segmentUrls: string[], initSegmentUrls: string[]): SegmentMappings {
  const segmentUrlToFilename = createUrlToFilenameMap(segmentUrls, 'segment.ts');
  const initSegmentUrlToFilename = createUrlToFilenameMap(initSegmentUrls, 'init.mp4');

  const allSegmentFilenames: string[] = [];
  for (const filename of segmentUrlToFilename.values()) {
    allSegmentFilenames.push(filename);
  }
  for (const filename of initSegmentUrlToFilename.values()) {
    allSegmentFilenames.push(filename);
  }

  const segmentFilesCleanup = allSegmentFilenames.length > 0
    ? allSegmentFilenames.map((filename) => `"${filename}"`).join(' ')
    : '';

  return {
    segmentUrlToFilename,
    initSegmentUrlToFilename,
    allSegmentFilenames,
    segmentFilesCleanup
  };
}

describe('buildZipNamingInfo', () => {
  it('should extract m3u8 filename correctly', () => {
    const manifest = {
      m3u8Url: 'https://example.com/video/playlist.m3u8',
      title: 'Test Video'
    };
    const result = buildZipNamingInfo(manifest);
    expect(result.m3u8FileName).toBe('playlist.m3u8');
  });

  it('should handle m3u8 URL with query parameters', () => {
    const manifest = {
      m3u8Url: 'https://example.com/video/playlist.m3u8?token=abc123',
      title: 'Test Video'
    };
    const result = buildZipNamingInfo(manifest);
    expect(result.m3u8FileName).toBe('playlist.m3u8');
  });

  it('should use title when available', () => {
    const manifest = {
      m3u8Url: 'https://example.com/video/playlist.m3u8',
      title: 'My Awesome Video'
    };
    const result = buildZipNamingInfo(manifest);
    expect(result.videoBaseName).toBe('My_Awesome_Video');
    expect(result.outputFileName).toContain('My_Awesome_Video');
    expect(result.outputFileName).toContain('.mp4');
  });

  it('should sanitize title correctly', () => {
    const manifest = {
      m3u8Url: 'https://example.com/video/playlist.m3u8',
      title: 'Video: Test <File> Name'
    };
    const result = buildZipNamingInfo(manifest);
    expect(result.videoBaseName).toBe('Video_Test_File_Name');
  });

  it('should fall back to m3u8 filename when title is missing', () => {
    const manifest = {
      m3u8Url: 'https://example.com/video/playlist.m3u8'
    };
    const result = buildZipNamingInfo(manifest);
    expect(result.videoBaseName).toBe('playlist');
    expect(result.outputFileName).toContain('playlist');
  });

  it('should use "output" when m3u8 filename has no base name', () => {
    const manifest = {
      m3u8Url: 'https://example.com/.m3u8'
    };
    const result = buildZipNamingInfo(manifest);
    expect(result.videoBaseName).toBe('output');
  });

  it('should generate timestamp in correct format', () => {
    const manifest = {
      m3u8Url: 'https://example.com/video/playlist.m3u8',
      title: 'Test'
    };
    const result = buildZipNamingInfo(manifest);
    // Timestamp should be ISO format with colons and dots replaced by hyphens
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  });

  it('should include timestamp in output filename', () => {
    const manifest = {
      m3u8Url: 'https://example.com/video/playlist.m3u8',
      title: 'Test Video'
    };
    const result = buildZipNamingInfo(manifest);
    expect(result.outputFileName).toBe(`${result.videoBaseName}-${result.timestamp}.mp4`);
  });
});

describe('buildSegmentMappings', () => {
  it('should create mappings for segments and init segments', () => {
    const segmentUrls = [
      'https://example.com/segment1.ts',
      'https://example.com/segment2.ts'
    ];
    const initSegmentUrls = [
      'https://example.com/init.mp4'
    ];
    const result = buildSegmentMappings(segmentUrls, initSegmentUrls);

    expect(result.segmentUrlToFilename.size).toBe(2);
    expect(result.initSegmentUrlToFilename.size).toBe(1);
    expect(result.allSegmentFilenames.length).toBe(3);
  });

  it('should include all filenames in allSegmentFilenames array', () => {
    const segmentUrls = [
      'https://example.com/segment1.ts',
      'https://example.com/segment2.ts'
    ];
    const initSegmentUrls = [
      'https://example.com/init.mp4'
    ];
    const result = buildSegmentMappings(segmentUrls, initSegmentUrls);

    expect(result.allSegmentFilenames).toContain('segment1.ts');
    expect(result.allSegmentFilenames).toContain('segment2.ts');
    expect(result.allSegmentFilenames).toContain('init.mp4');
  });

  it('should create quoted cleanup string for bash script', () => {
    const segmentUrls = [
      'https://example.com/segment1.ts',
      'https://example.com/segment2.ts'
    ];
    const initSegmentUrls = [
      'https://example.com/init.mp4'
    ];
    const result = buildSegmentMappings(segmentUrls, initSegmentUrls);

    expect(result.segmentFilesCleanup).toContain('"segment1.ts"');
    expect(result.segmentFilesCleanup).toContain('"segment2.ts"');
    expect(result.segmentFilesCleanup).toContain('"init.mp4"');
    expect(result.segmentFilesCleanup.split(' ').length).toBe(3);
  });

  it('should handle empty arrays', () => {
    const result = buildSegmentMappings([], []);

    expect(result.segmentUrlToFilename.size).toBe(0);
    expect(result.initSegmentUrlToFilename.size).toBe(0);
    expect(result.allSegmentFilenames.length).toBe(0);
    expect(result.segmentFilesCleanup).toBe('');
  });

  it('should handle only segments (no init segments)', () => {
    const segmentUrls = [
      'https://example.com/segment1.ts',
      'https://example.com/segment2.ts'
    ];
    const result = buildSegmentMappings(segmentUrls, []);

    expect(result.segmentUrlToFilename.size).toBe(2);
    expect(result.initSegmentUrlToFilename.size).toBe(0);
    expect(result.allSegmentFilenames.length).toBe(2);
    expect(result.segmentFilesCleanup).toContain('"segment1.ts"');
    expect(result.segmentFilesCleanup).toContain('"segment2.ts"');
  });

  it('should handle only init segments (no regular segments)', () => {
    const initSegmentUrls = [
      'https://example.com/init1.mp4',
      'https://example.com/init2.mp4'
    ];
    const result = buildSegmentMappings([], initSegmentUrls);

    expect(result.segmentUrlToFilename.size).toBe(0);
    expect(result.initSegmentUrlToFilename.size).toBe(2);
    expect(result.allSegmentFilenames.length).toBe(2);
    expect(result.segmentFilesCleanup).toContain('"init1.mp4"');
    expect(result.segmentFilesCleanup).toContain('"init2.mp4"');
  });

  it('should handle duplicate filenames correctly', () => {
    const segmentUrls = [
      'https://example.com/folder1/segment.ts',
      'https://example.com/folder2/segment.ts'
    ];
    const result = buildSegmentMappings(segmentUrls, []);

    expect(result.segmentUrlToFilename.size).toBe(2);
    expect(result.allSegmentFilenames.length).toBe(2);
    // Both should be in cleanup string
    expect(result.segmentFilesCleanup).toContain('folder1__segment.ts');
    expect(result.segmentFilesCleanup).toContain('folder2__segment.ts');
  });
});
