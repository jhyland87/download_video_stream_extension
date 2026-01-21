/**
 * @fileoverview Side panel React component for managing ignored domains.
 */

import { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ExtensionMessage,
  ExtensionResponse,
  IgnoreListResponse,
  GetCurrentTabResponse,
  AddToIgnoreListMessage,
  RemoveFromIgnoreListMessage
} from './types/index.js';
import { logger } from './utils/logger.js';

/**
 * Extracts domain from a URL.
 * @param url - The URL to extract domain from
 * @returns The domain or undefined if URL is invalid
 */
function extractDomain(url: string): string | undefined {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return undefined;
  }
}

/**
 * Main SidePanel component for ignore list management.
 */
const SidePanel = () => {
  const [ignoredDomains, setIgnoredDomains] = useState<string[]>([]);
  const [currentDomain, setCurrentDomain] = useState<string | undefined>(undefined);
  const [currentUrl, setCurrentUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Load ignore list and current tab
  const loadData = useCallback(() => {
    setLoading(true);
    setError('');
    setSuccess('');

    // Get current tab info
    chrome.runtime.sendMessage({ action: 'getCurrentTab' } as ExtensionMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        logger.error('Error getting current tab:', chrome.runtime.lastError);
        setError('Could not get current tab. Make sure you are on a valid page.');
        setLoading(false);
        return;
      }

      if (response && 'url' in response) {
        const tabResponse = response as GetCurrentTabResponse;
        setCurrentUrl(tabResponse.url);
        if (tabResponse.domain) {
          setCurrentDomain(tabResponse.domain);
        } else if (tabResponse.url) {
          setCurrentDomain(extractDomain(tabResponse.url));
        }
      }
    });

    // Get ignore list
    chrome.runtime.sendMessage({ action: 'getIgnoreList' } as ExtensionMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        logger.error('Error getting ignore list:', chrome.runtime.lastError);
        setError('Could not load ignore list.');
        setLoading(false);
        return;
      }

      if (response && 'domains' in response) {
        const ignoreListResponse = response as IgnoreListResponse;
        setIgnoredDomains(ignoreListResponse.domains);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Add current domain to ignore list
  const addCurrentDomain = useCallback(() => {
    if (!currentDomain) {
      setError('No domain to add.');
      return;
    }

    if (ignoredDomains.includes(currentDomain)) {
      setError(`${currentDomain} is already in the ignore list.`);
      return;
    }

    setError('');
    setSuccess('');

    chrome.runtime.sendMessage({
      action: 'addToIgnoreList',
      domain: currentDomain
    } as AddToIgnoreListMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        setError(`Failed to add domain: ${errorMsg}`);
        return;
      }

      if (response && 'error' in response) {
        setError(response.error || 'Failed to add domain.');
        return;
      }

      // Reload ignore list
      setSuccess(`${currentDomain} added to ignore list.`);
      loadData();
    });
  }, [currentDomain, ignoredDomains, loadData]);

  // Remove domain from ignore list
  const removeDomain = useCallback((domain: string) => {
    setError('');
    setSuccess('');

    chrome.runtime.sendMessage({
      action: 'removeFromIgnoreList',
      domain: domain
    } as RemoveFromIgnoreListMessage, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        setError(`Failed to remove domain: ${errorMsg}`);
        return;
      }

      if (response && 'error' in response) {
        setError(response.error || 'Failed to remove domain.');
        return;
      }

      // Reload ignore list
      setSuccess(`${domain} removed from ignore list.`);
      loadData();
    });
  }, [loadData]);

  if (loading) {
    return (
      <div>
        <h1>Ignore List</h1>
        <p>Loading...</p>
      </div>
    );
  }

  const isCurrentDomainIgnored = currentDomain && ignoredDomains.includes(currentDomain);

  return (
    <div>
      <h1>Ignore List</h1>
      <p style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
        Domains in the ignore list will not be processed by the extension. This includes all videos, iframes, and external resources from those domains.
      </p>

      {currentDomain && (
        <div className="current-domain">
          <div className="current-domain-label">Current Page Domain:</div>
          <div className="current-domain-value">{currentDomain}</div>
          {isCurrentDomainIgnored ? (
            <button className="button secondary" disabled>
              Already Ignored
            </button>
          ) : (
            <button className="button primary" onClick={addCurrentDomain}>
              Add {currentDomain} to Ignore List
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="error">{error}</div>
      )}

      {success && (
        <div className="success">{success}</div>
      )}

      <h2>Ignored Domains ({ignoredDomains.length})</h2>
      {ignoredDomains.length === 0 ? (
        <div className="empty-state">No domains in ignore list.</div>
      ) : (
        <div className="ignored-domains-list">
          {ignoredDomains.map((domain) => (
            <div key={domain} className="ignored-domain-item">
              <span className="domain-name">{domain}</span>
              <button
                className="remove-button"
                onClick={() => removeDomain(domain)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Initialize React app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  logger.log('Side panel DOMContentLoaded fired - initializing React app');

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    logger.error('Root element not found!');
    return;
  }

  const root = createRoot(rootElement);
  root.render(<SidePanel />);
});
