/**
 * Type definitions for domain ignore list functionality
 */

/**
 * Ignore list management message actions
 */
export type IgnoreListAction = 'getIgnoreList' | 'addToIgnoreList' | 'removeFromIgnoreList';

/**
 * Get ignore list message
 */
export interface GetIgnoreListMessage {
  action: 'getIgnoreList';
}

/**
 * Add domain to ignore list message
 */
export interface AddToIgnoreListMessage {
  action: 'addToIgnoreList';
  domain: string;
}

/**
 * Remove domain from ignore list message
 */
export interface RemoveFromIgnoreListMessage {
  action: 'removeFromIgnoreList';
  domain: string;
}

/**
 * Ignore list response
 */
export interface IgnoreListResponse {
  domains: string[];
}
