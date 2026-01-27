/**
 * Utility functions for popup UI formatting and data manipulation
 */

import type { ManifestSummary, DomainGroup } from '../types';

/**
 * Formats bytes into a human-readable string (B, KB, MB, GB).
 * @param bytes - The number of bytes to format
 * @returns A formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Formats download speed into a human-readable string.
 * @param bytesPerSecond - The download speed in bytes per second
 * @returns A formatted string (e.g., "1.5 MB/s")
 */
export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

/**
 * Formats duration into a human-readable string (H:MM:SS or MM:SS).
 * @param durationSeconds - The duration in seconds
 * @returns A formatted string (e.g., "1:23:45" or "23:45")
 */
export function formatDuration(durationSeconds: number): string {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = Math.floor(durationSeconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extracts filename from a URL.
 * @param url - The URL to extract filename from
 * @returns The filename or 'm3u8' as default
 */
export function extractFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    return pathParts[pathParts.length - 1] || 'm3u8';
  } catch (error) {
    // Fallback for invalid URLs
    const urlWithoutQuery = url.split('?')[0];
    const pathParts = urlWithoutQuery.split('/').filter(part => part.length > 0);
    return pathParts[pathParts.length - 1] || 'm3u8';
  }
}

/**
 * Formats a page URL for display: domain + last 10 characters of path (without query/hash).
 * @param url - The full URL to format
 * @returns Formatted string like "example.com/.../path" or undefined if URL is invalid
 */
export function formatPageUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    // Remove query params and hash
    const pathWithoutQuery = urlObj.pathname;
    // Get last 10 characters of path (or full path if shorter)
    const lastPath = pathWithoutQuery.length > 10
      ? '...' + pathWithoutQuery.slice(-10)
      : pathWithoutQuery;

    return `${domain}${lastPath}`;
  } catch (error) {
    // Invalid URL, return undefined
    return undefined;
  }
}

/**
 * Groups manifests by domain and sorts them.
 * @param manifestsList - List of manifests to group
 * @param mostRecentDomain - Optional domain to prioritize at the top
 * @param activeDownloadIds - Set of manifest IDs that have active downloads
 * @returns Array of domain groups sorted by most recent capture, with active downloads prioritized
 */
export function groupManifestsByDomain(
  manifestsList: ManifestSummary[],
  mostRecentDomain: string | null = null,
  activeDownloadIds: Set<string> = new Set()
): DomainGroup[] {
  // Group by domain
  const domainMap = new Map<string, ManifestSummary[]>();
  for (const manifest of manifestsList) {
    const domain = manifest.pageDomain || 'Unknown Domain';
    if (!domainMap.has(domain)) {
      domainMap.set(domain, []);
    }
    domainMap.get(domain)!.push(manifest);
  }

  // Sort within each group: active downloads first, then by capturedAt (newest first)
  const groups: DomainGroup[] = [];
  for (const [domain, domainManifests] of domainMap.entries()) {
    const sorted = domainManifests.sort((a, b) => {
      const aIsActive = activeDownloadIds.has(a.id);
      const bIsActive = activeDownloadIds.has(b.id);

      // If one has active download and the other doesn't, prioritize the active one
      if (aIsActive && !bIsActive) return -1;
      if (!aIsActive && bIsActive) return 1;

      // If both have active downloads or neither does, sort by capturedAt (newest first)
      return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
    });
    const mostRecentCapture = sorted[0]?.capturedAt || '';
    groups.push({
      domain,
      manifests: sorted,
      mostRecentCapture
    });
  }

  // Sort groups: groups with active downloads first, then by most recent capture
  // If a domain was just captured, bump it to the top
  groups.sort((a, b) => {
    // Check if groups have active downloads
    const aHasActive = a.manifests.some((m: ManifestSummary) => activeDownloadIds.has(m.id));
    const bHasActive = b.manifests.some((m: ManifestSummary) => activeDownloadIds.has(m.id));

    // If one group has active downloads and the other doesn't, prioritize it
    if (aHasActive && !bHasActive) return -1;
    if (!aHasActive && bHasActive) return 1;

    // If mostRecentDomain is set and matches a group, prioritize it
    if (mostRecentDomain && a.domain === mostRecentDomain) {
      return -1;
    }
    if (mostRecentDomain && b.domain === mostRecentDomain) {
      return 1;
    }
    // Otherwise sort by most recent capture
    return new Date(b.mostRecentCapture).getTime() - new Date(a.mostRecentCapture).getTime();
  });

  return groups;
}
