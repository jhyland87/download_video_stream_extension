/**
 * Icon utilities for Chrome extension action icons
 * Maps download states to icon files in assets/icons/
 */

import type { DownloadProgress, IconType } from '../types';

/**
 * Gets icon paths for a given icon type
 * @param iconType - The type of icon
 * @returns Icon paths object with 16, 48, and 128 sizes
 */
export function getIconPaths(iconType: IconType): { 16: string; 48: string; 128: string } {
  // Map icon types to filenames in assets/icons/
  const iconMap: Record<IconType, string> = {
    default: 'default',
    downloading: 'downloading',
    compressing: 'zip-archive',
    saving: 'save-file',
    'found-video': 'found-video'
  };

  const iconName = iconMap[iconType];

  return {
    16: `assets/icons/${iconName}-48x48.png`,
    48: `assets/icons/${iconName}-48x48.png`,
    128: `assets/icons/${iconName}-48x48.png`
  };
}

/**
 * Determines the appropriate icon type based on download progress
 * @param progress - Download progress information
 * @param zipGenerated - Whether ZIP generation has completed
 * @returns Icon type to use
 */
export function getIconType(progress: DownloadProgress | null, zipGenerated: boolean = false): IconType {
  if (!progress) {
    return 'default';
  }

  if (progress.status === 'complete' || progress.status === 'canceled') {
    return 'default';
  }

  if (progress.status === 'creating_zip') {
    // If ZIP is generated and we have size, we're about to save it
    if (zipGenerated && progress.zipSize) {
      return 'saving';
    }
    // Otherwise we're still compressing
    return 'compressing';
  }

  if (progress.status === 'downloading') {
    return 'downloading';
  }

  return 'default';
}
