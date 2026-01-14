import esbuild from 'esbuild';
import { execSync } from 'child_process';

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
    // Build popup script
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/popup.ts'],
      outfile: 'dist/popup.js',
      globalName: 'PopupScript',
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

