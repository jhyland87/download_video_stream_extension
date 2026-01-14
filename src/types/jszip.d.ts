/**
 * Type definitions for JSZip library
 * Since we're loading it via importScripts, we need to declare it globally.
 * We use the official types from the jszip npm package.
 */

/// <reference types="jszip" />

// Declare JSZip as a global since we load it via importScripts
declare const JSZip: typeof import('jszip');

