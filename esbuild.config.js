import esbuild from 'esbuild';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as sass from 'sass';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

const baseConfig = {
  bundle: true,
  minify: isProduction,
  sourcemap: true,
  target: 'es2022',
  format: 'iife', // Immediately Invoked Function Expression - no ES modules
  platform: 'browser',
  logLevel: 'info',
};

async function build() {
  try {
    // Ensure dist directory exists
    const distDir = join(__dirname, 'dist');
    mkdirSync(distDir, { recursive: true });

    // Compile SCSS to CSS
    const scssResult = sass.compile(join(__dirname, 'src', 'popup.scss'), {
      style: isProduction ? 'compressed' : 'expanded',
    });
    
    // Write compiled CSS to dist
    const cssPath = join(__dirname, 'dist', 'popup.css');
    writeFileSync(cssPath, scssResult.css);

    // Build popup script (React app)
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/popup.tsx'],
      outfile: 'dist/popup.js',
      globalName: 'PopupScript',
      jsx: 'automatic', // Use React 17+ JSX transform
      define: {
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
      },
    });

    // Build content script
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/content.ts'],
      outfile: 'dist/content.js',
      globalName: 'ContentScript',
    });

    // Build background script with esbuild
    // We need to preserve the importScripts call, so we'll add it as a banner
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/background.ts'],
      outfile: 'dist/background.js',
      globalName: 'BackgroundScript',
      banner: {
        js: "importScripts('jszip.min.js');",
      },
      // Don't bundle jszip since we load it via importScripts
      external: ['jszip'],
    });

    console.log('Build complete!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();

