/**
 * @fileoverview Component for displaying and cycling through preview images on hover.
 */

import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import type { PreviewImageProps } from '../types';
import { logger } from '../utils/logger';

/**
 * Component for displaying and cycling through preview images on hover.
 */
export const PreviewImage = ({ previewUrls }: PreviewImageProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const previewDivRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const div = previewDivRef.current;
    if (!div || previewUrls.length <= 1) return;

    const handleMouseEnter = () => {
      if (intervalRef.current !== null) return; // Already cycling

      intervalRef.current = window.setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % previewUrls.length);
      }, 1000);
    };

    const handleMouseLeave = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCurrentIndex(0);
    };

    div.addEventListener('mouseenter', handleMouseEnter);
    div.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      div.removeEventListener('mouseenter', handleMouseEnter);
      div.removeEventListener('mouseleave', handleMouseLeave);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [previewUrls]);

  if (!previewUrls || previewUrls.length === 0) {
    return null;
  }

  return (
    <Box
      ref={previewDivRef}
      className="preview-image-container"
    >
      <img
        src={previewUrls[currentIndex]}
        alt="Video preview"
        className="preview-image"
        onError={(e) => {
          logger.error('Preview image failed to load');
          (e.target as HTMLImageElement).classList.add('hidden');
        }}
      />
    </Box>
  );
};
