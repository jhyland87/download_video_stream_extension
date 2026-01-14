#!/bin/bash
# Build script for the extension
# Compiles TypeScript and copies necessary files to dist/

set -e

echo "Building extension..."

# Clean previous build
rm -rf dist
mkdir -p dist

# Compile TypeScript
echo "Compiling TypeScript..."
npx tsc

# Copy necessary files
echo "Copying assets..."
cp -r jszip.min.js dist/
cp popup.html dist/
cp manifest.json dist/
cp icon*.png dist/ 2>/dev/null || true

# Update manifest.json to point to compiled files
echo "Updating manifest.json..."
sed -i.bak 's/"service_worker": "background.js"/"service_worker": "background.js"/' dist/manifest.json
rm -f dist/manifest.json.bak

echo "Build complete! Output in dist/"

