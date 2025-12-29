// Popup script for UI interaction

let statusInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const downloadMp4Btn = document.getElementById('downloadMp4Btn');
  const clearBtn = document.getElementById('clearBtn');
  const statusDiv = document.getElementById('status');
  const manifestInfo = document.getElementById('manifestInfo');
  const manifestName = document.getElementById('manifestName');
  const segmentCount = document.getElementById('segmentCount');
  const progressDiv = document.getElementById('progress');
  const progressFill = document.getElementById('progressFill');
  const progressInfo = document.getElementById('progressInfo');
  const errorDiv = document.getElementById('error');

  // Update status periodically
  function updateStatus() {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }

      if (response) {
        if (response.hasManifest && response.m3u8FileName) {
          // Show manifest info
          manifestInfo.style.display = 'block';
          manifestName.textContent = response.m3u8FileName;
          segmentCount.textContent = `${response.segmentCount || 0} segments found`;
          statusDiv.textContent = 'Manifest ready for download';
          statusDiv.className = 'status active';
          downloadZipBtn.disabled = false;
          downloadMp4Btn.disabled = false;
          clearBtn.disabled = false;
        } else {
          // No manifest yet
          manifestInfo.style.display = 'none';
          statusDiv.textContent = 'Monitoring for video streams...';
          statusDiv.className = 'status';
          downloadZipBtn.disabled = true;
          downloadMp4Btn.disabled = true;
          clearBtn.disabled = true;
        }
      }
    });
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'downloadProgress') {
      const percent = Math.round((message.downloaded / message.total) * 100);
      progressFill.style.width = percent + '%';
      progressFill.textContent = `${percent}%`;
      progressInfo.textContent = `Downloaded ${message.downloaded} of ${message.total} segments`;
      progressDiv.classList.add('active');
    } else if (message.action === 'manifestCaptured') {
      // New manifest detected
      console.log('[Stream Video Saver] Manifest captured:', message.fileName);
      updateStatus();
    }
  });

  downloadZipBtn.addEventListener('click', async () => {
    errorDiv.classList.remove('show');
    progressDiv.classList.add('active');
    progressFill.style.width = '0%';
    progressFill.textContent = '0%';
    progressInfo.textContent = 'Starting download...';

    try {
      // Get captured data from background
      const data = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'getCapturedData' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (!data.m3u8Url || !data.m3u8Content) {
        throw new Error('No m3u8 file captured');
      }

      // Wait for JSZip to be available (with retry)
      let retries = 10;
      while (typeof JSZip === 'undefined' && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries--;
      }
      
      if (typeof JSZip === 'undefined') {
        console.error('[Stream Video Saver] JSZip not available after waiting');
        throw new Error('JSZip library not loaded. Please reload the extension.');
      }
      
      console.log('[Stream Video Saver] JSZip loaded successfully');
      
      const zip = new JSZip();
      
      // Modify m3u8 content to use local filenames (remove query params and convert URLs to filenames)
      const modifiedM3U8Content = modifyM3U8ForLocalFiles(data.m3u8Content, data.m3u8Url);
      
      // Add m3u8 file
      const m3u8FileName = data.m3u8Url.substring(data.m3u8Url.lastIndexOf('/') + 1).split('?')[0];
      zip.file(m3u8FileName, modifiedM3U8Content);
      
      // Parse m3u8 to get segment URLs
      console.log('[Stream Video Saver] Parsing m3u8 for segments...');
      const segmentUrls = parseM3U8(data.m3u8Content, data.m3u8Url);
      console.log('[Stream Video Saver] Found', segmentUrls.length, 'segments to download');
      
      let downloaded = 0;
      const total = segmentUrls.length;
      
      if (total === 0) {
        console.error('[Stream Video Saver] No segments found in m3u8 file');
        console.log('[Stream Video Saver] M3U8 content preview:', data.m3u8Content.substring(0, 500));
        throw new Error('No segments found in m3u8 file');
      }
      
      console.log('[Stream Video Saver] First few segment URLs:', segmentUrls.slice(0, 5));
      
      // Download segments in batches
      const batchSize = 5;
      for (let i = 0; i < segmentUrls.length; i += batchSize) {
        const batch = segmentUrls.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (url) => {
          try {
            console.log('[Stream Video Saver] Downloading segment:', url);
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const blob = await response.blob();
            
            // Extract filename using same logic as modifyM3U8ForLocalFiles
            let fileName;
            try {
              if (url.startsWith('http://') || url.startsWith('https://')) {
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/');
                fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
              } else {
                fileName = url.split('?')[0].split('/').pop();
              }
              // Remove query parameters if any
              fileName = fileName.split('?')[0];
            } catch (error) {
              // Fallback to simple extraction
              fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
            }
            
            if (!fileName) {
              throw new Error('Could not extract filename from URL');
            }
            
            console.log('[Stream Video Saver] Adding to ZIP:', fileName, '(', blob.size, 'bytes)');
            zip.file(fileName, blob);
            downloaded++;
            
            // Notify background that segment was downloaded (for progress tracking)
            chrome.runtime.sendMessage({
              action: 'segmentDownloaded',
              segmentUrl: url
            }).catch(() => {});
            
            // Update progress
            const percent = Math.round((downloaded / total) * 100);
            progressFill.style.width = percent + '%';
            progressFill.textContent = `${percent}%`;
            progressInfo.textContent = `Downloaded ${downloaded} of ${total} segments`;
            
            if (downloaded === total) {
              console.log('[Stream Video Saver] ✅ All segments downloaded locally!');
            }
          } catch (error) {
            console.error('[Stream Video Saver] Error downloading segment', url, ':', error);
          }
        }));
      }
      
      // Generate zip file
      progressInfo.textContent = 'Creating ZIP file...';
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      
      // Create download
      const url = URL.createObjectURL(zipBlob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const zipFileName = `stream-video-${timestamp}.zip`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = zipFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      
      progressInfo.textContent = 'Download complete!';
      
      console.log('[Stream Video Saver] ✅ All segments downloaded and ZIP created!');
      
      setTimeout(() => {
        progressDiv.classList.remove('active');
        updateStatus();
      }, 2000);
      
    } catch (error) {
      showError(error.message);
      progressDiv.classList.remove('active');
    }
  });

  // MP4 Download Handler
  downloadMp4Btn.addEventListener('click', async () => {
    errorDiv.classList.remove('show');
    progressDiv.classList.add('active');
    progressFill.style.width = '0%';
    progressFill.textContent = '0%';
    progressInfo.textContent = 'Loading FFmpeg...';

    try {
      // Get captured data from background
      const data = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'getCapturedData' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (!data.m3u8Url || !data.m3u8Content) {
        throw new Error('No m3u8 file captured');
      }

      // Wait for FFmpeg to be available (it's exported as FFmpegWASM in UMD build)
      let retries = 20;
      while (typeof window.FFmpegWASM === 'undefined' && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
        retries--;
      }
      
      if (typeof window.FFmpegWASM === 'undefined') {
        console.error('[Stream Video Saver] FFmpegWASM not found. Available globals:', Object.keys(window).filter(k => k.includes('ffmpeg') || k.includes('FFmpeg')));
        throw new Error('FFmpeg library not loaded. Please reload the extension.');
      }

      console.log('[Stream Video Saver] FFmpeg loaded, initializing...');
      progressInfo.textContent = 'Initializing FFmpeg...';
      
      const { FFmpeg } = window.FFmpegWASM;
      const ffmpeg = new FFmpeg();
      
      // Set up logging (FFmpeg.wasm uses 'on' method for events)
      ffmpeg.on('log', ({ message }) => {
        console.log('[FFmpeg]', message);
      });
      
      ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.round(progress * 100);
        progressFill.style.width = percent + '%';
        progressFill.textContent = `${percent}%`;
        progressInfo.textContent = `Converting to MP4... ${percent}%`;
      });

      // Load FFmpeg core from local files
      progressInfo.textContent = 'Loading FFmpeg core (this may take a moment)...';
      
      const coreJsUrl = chrome.runtime.getURL('ffmpeg-core/ffmpeg-core.js');
      const coreWasmUrl = chrome.runtime.getURL('ffmpeg-core/ffmpeg-core.wasm');
      
      console.log('[Stream Video Saver] Loading FFmpeg core from:', coreJsUrl, coreWasmUrl);
      
      // Verify files are accessible
      try {
        progressInfo.textContent = 'Verifying FFmpeg core files...';
        const jsResponse = await fetch(coreJsUrl);
        if (!jsResponse.ok) {
          throw new Error(`Cannot access FFmpeg core JS file: ${jsResponse.status}`);
        }
        console.log('[Stream Video Saver] FFmpeg core JS file accessible');
        
        const wasmResponse = await fetch(coreWasmUrl);
        if (!wasmResponse.ok) {
          throw new Error(`Cannot access FFmpeg core WASM file: ${wasmResponse.status}`);
        }
        console.log('[Stream Video Saver] FFmpeg core WASM file accessible');
      } catch (error) {
        console.error('[Stream Video Saver] Error verifying FFmpeg core files:', error);
        throw new Error(`Cannot access FFmpeg core files: ${error.message}. Make sure the extension is reloaded.`);
      }
      
      // Add timeout to prevent hanging (WASM file is 31MB, so give it time)
      // Show animated status updates while loading
      let loadingDots = 0;
      let elapsedSeconds = 0;
      const loadingInterval = setInterval(() => {
        loadingDots = (loadingDots + 1) % 4;
        elapsedSeconds += 0.5;
        const dots = '.'.repeat(loadingDots);
        progressInfo.textContent = `Loading FFmpeg core (31MB WASM file)${dots} ${Math.round(elapsedSeconds)}s elapsed`;
      }, 500);
      
      console.log('[Stream Video Saver] Starting ffmpeg.load() with:', { coreJsUrl, coreWasmUrl });
      console.log('[Stream Video Saver] ffmpeg object:', ffmpeg);
      console.log('[Stream Video Saver] ffmpeg.loaded before load:', ffmpeg.loaded);
      
      // Monitor ffmpeg.loaded status
      const statusCheckInterval = setInterval(() => {
        if (ffmpeg.loaded) {
          console.log('[Stream Video Saver] ✅ ffmpeg.loaded is now true!');
          clearInterval(statusCheckInterval);
        } else {
          console.log('[Stream Video Saver] ⏳ ffmpeg.loaded is still false, waiting...');
        }
      }, 1000);
      
      const loadPromise = ffmpeg.load({
        coreURL: coreJsUrl,
        wasmURL: coreWasmUrl
      }).then(() => {
        clearInterval(loadingInterval);
        clearInterval(statusCheckInterval);
        console.log('[Stream Video Saver] ffmpeg.load() resolved successfully');
        console.log('[Stream Video Saver] ffmpeg.loaded after load:', ffmpeg.loaded);
        progressInfo.textContent = 'FFmpeg core loaded successfully!';
        return true;
      }).catch((error) => {
        clearInterval(loadingInterval);
        clearInterval(statusCheckInterval);
        console.error('[Stream Video Saver] ffmpeg.load() rejected with error:', error);
        console.error('[Stream Video Saver] Error stack:', error.stack);
        throw error;
      });
      
      // Log when load starts
      console.log('[Stream Video Saver] ffmpeg.load() promise created, waiting for resolution...');
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          clearInterval(loadingInterval);
          clearInterval(statusCheckInterval);
          console.error('[Stream Video Saver] FFmpeg load timeout after 60 seconds');
          console.error('[Stream Video Saver] ffmpeg.loaded at timeout:', ffmpeg.loaded);
          reject(new Error('FFmpeg core loading timed out after 60 seconds. The WASM file is large (31MB) and may need more time on slower connections.'));
        }, 60000);
      });
      
      console.log('[Stream Video Saver] Racing load promise against timeout...');
      const result = await Promise.race([loadPromise, timeoutPromise]);
      console.log('[Stream Video Saver] Promise.race resolved with:', result);

      console.log('[Stream Video Saver] FFmpeg initialized successfully');

      // Parse m3u8 to get segment URLs
      const segmentUrls = parseM3U8(data.m3u8Content, data.m3u8Url);
      console.log('[Stream Video Saver] Found', segmentUrls.length, 'segments to download');

      if (segmentUrls.length === 0) {
        throw new Error('No segments found in m3u8 file');
      }

      // Download all segments
      progressInfo.textContent = 'Downloading segments...';
      const segments = [];
      let downloaded = 0;
      const total = segmentUrls.length;

      const batchSize = 5;
      for (let i = 0; i < segmentUrls.length; i += batchSize) {
        const batch = segmentUrls.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (url, idx) => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            
            // Extract filename
            let fileName;
            try {
              if (url.startsWith('http://') || url.startsWith('https://')) {
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/');
                fileName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
              } else {
                fileName = url.split('?')[0].split('/').pop();
              }
              fileName = fileName.split('?')[0];
            } catch (error) {
              fileName = `seg-${i + idx + 1}.ts`;
            }
            
            segments.push({ name: fileName, data: arrayBuffer });
            downloaded++;
            
            const percent = Math.round((downloaded / total) * 50); // First 50% is downloading
            progressFill.style.width = percent + '%';
            progressFill.textContent = `${percent}%`;
            progressInfo.textContent = `Downloaded ${downloaded} of ${total} segments`;
          } catch (error) {
            console.error('[Stream Video Saver] Error downloading segment', url, ':', error);
          }
        }));
      }

      console.log('[Stream Video Saver] All segments downloaded, writing to FFmpeg...');
      progressInfo.textContent = 'Preparing segments for conversion...';

      // Write segments to FFmpeg filesystem
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        await ffmpeg.writeFile(seg.name, new Uint8Array(seg.data));
        const percent = 50 + Math.round((i / segments.length) * 10); // 50-60% is writing
        progressFill.style.width = percent + '%';
        progressFill.textContent = `${percent}%`;
      }

      // Create concat file for FFmpeg
      const concatContent = segments.map((seg, idx) => `file '${seg.name}'`).join('\n');
      await ffmpeg.writeFile('concat.txt', concatContent);

      console.log('[Stream Video Saver] Converting to MP4...');
      progressInfo.textContent = 'Converting to MP4 (this may take a while)...';

      // Convert using FFmpeg
      // Use concat demuxer for better compatibility
      const outputFileName = data.m3u8FileName ? data.m3u8FileName.replace('.m3u8', '.mp4') : 'output.mp4';
      
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',
        outputFileName
      ]);

      console.log('[Stream Video Saver] Conversion complete, reading MP4 file...');
      progressInfo.textContent = 'Finalizing MP4 file...';

      // Read the output file
      const mp4Data = await ffmpeg.readFile(outputFileName);
      
      // Create download
      const blob = new Blob([mp4Data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const mp4FileName = `stream-video-${timestamp}.mp4`;

      const a = document.createElement('a');
      a.href = url;
      a.download = mp4FileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      progressInfo.textContent = 'Download complete!';
      console.log('[Stream Video Saver] ✅ MP4 file created and downloaded!');

      setTimeout(() => {
        progressDiv.classList.remove('active');
        updateStatus();
      }, 2000);

    } catch (error) {
      console.error('[Stream Video Saver] MP4 conversion error:', error);
      showError(error.message || 'Failed to convert to MP4. Try downloading as ZIP instead.');
      progressDiv.classList.remove('active');
    }
  });
  
  function modifyM3U8ForLocalFiles(content, baseUrl) {
    console.log('[Stream Video Saver] Modifying m3u8 to use local filenames');
    const lines = content.split('\n');
    const modifiedLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Keep comments and empty lines as-is
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        modifiedLines.push(line);
        continue;
      }
      
      // This is a segment URL line - extract just the filename
      try {
        let filename;
        
        // If it's a full URL, parse it
        if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
          const url = new URL(trimmedLine);
          // Get just the filename from the pathname
          const pathParts = url.pathname.split('/');
          filename = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
        } else if (trimmedLine.startsWith('/')) {
          // Absolute path - extract filename
          const pathParts = trimmedLine.split('/');
          filename = pathParts[pathParts.length - 1];
        } else {
          // Relative path - extract filename (may include query params)
          // Remove query parameters if present
          filename = trimmedLine.split('?')[0].split('/').pop();
        }
        
        // Ensure we have a filename
        if (!filename) {
          console.warn('[Stream Video Saver] Could not extract filename from:', trimmedLine);
          modifiedLines.push(line); // Keep original if we can't parse it
          continue;
        }
        
        // Remove any remaining query parameters from filename
        filename = filename.split('?')[0];
        
        console.log('[Stream Video Saver] Replacing:', trimmedLine, '->', filename);
        modifiedLines.push(filename);
      } catch (error) {
        console.error('[Stream Video Saver] Error processing line:', trimmedLine, error);
        modifiedLines.push(line); // Keep original on error
      }
    }
    
    const modifiedContent = modifiedLines.join('\n');
    console.log('[Stream Video Saver] Modified m3u8 content length:', modifiedContent.length, 'chars');
    return modifiedContent;
  }
  
  function parseM3U8(content, baseUrl) {
    console.log('[Stream Video Saver] Parsing m3u8 in popup, baseUrl:', baseUrl);
    const lines = content.split('\n');
    const segmentUrls = [];
    
    if (!baseUrl) {
      console.warn('[Stream Video Saver] No baseUrl provided');
      return segmentUrls;
    }
    
    const base = new URL(baseUrl);
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    console.log('[Stream Video Saver] Base origin:', base.origin, 'Base path:', basePath);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }
      
      // This is a URL line (any non-comment, non-empty line)
      // This works for any segment naming convention
      if (line && !line.startsWith('#')) {
        let segmentUrl;
        
        // Handle relative URLs
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
    
    console.log('[Stream Video Saver] Parsed', segmentUrls.length, 'segment URLs');
    return segmentUrls;
  }

  // Clear button handler
  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearManifest' }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }
      if (response && response.success) {
        console.log('[Stream Video Saver] Manifest cleared');
        updateStatus(); // Refresh the UI
      }
    });
  });

  function showError(message) {
    errorDiv.textContent = 'Error: ' + message;
    errorDiv.classList.add('show');
  }

  // Initial status update
  updateStatus();
  // Update status every 2 seconds to check for new manifests
  statusInterval = setInterval(updateStatus, 2000);
});

