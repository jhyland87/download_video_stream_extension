#!/bin/bash
# Simple script to create placeholder icons using ImageMagick (if available)
# Or creates a note that icons need to be created manually

if command -v convert &> /dev/null; then
  echo "Creating icons with ImageMagick..."
  convert -size 16x16 xc:#1976d2 -pointsize 10 -fill white -gravity center -annotate +0+0 "S" icon16.png
  convert -size 48x48 xc:#1976d2 -pointsize 30 -fill white -gravity center -annotate +0+0 "S" icon48.png
  convert -size 128x128 xc:#1976d2 -pointsize 80 -fill white -gravity center -annotate +0+0 "S" icon128.png
  echo "Icons created!"
else
  echo "ImageMagick not found. Please:"
  echo "1. Open create-icons.html in a browser"
  echo "2. Right-click each canvas and save as icon16.png, icon48.png, icon128.png"
  echo "OR install ImageMagick and run this script again"
fi
