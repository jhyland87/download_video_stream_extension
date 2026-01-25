import { vi } from 'vitest';

/**
 * Mock Document
 */
export const mockDocument = {
  getElementsByTagName: vi.fn(),
  querySelector: vi.fn(),
  createElement: vi.fn()
} as unknown as Document;

/**
 * Mock HTMLVideoElement
 */
export class MockHTMLVideoElement {
  title = '';
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  currentTime = 0;
  duration = 0;
  paused = false;
  playbackRate = 1.0;
  muted = false;

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  getAttribute = vi.fn();

  constructor() {
    // Mock properties
  }
}

/**
 * Mock HTMLCanvasElement
 */
export class MockHTMLCanvasElement {
  width = 0;
  height = 0;
  getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    canvas: {
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,test')
    }
  });
  toDataURL = vi.fn().mockReturnValue('data:image/png;base64,test');
}

/**
 * Setup DOM mocks globally
 */
export function setupDOMMocks(): void {
  global.document = mockDocument;
  global.HTMLVideoElement = MockHTMLVideoElement as unknown as typeof HTMLVideoElement;
  global.HTMLCanvasElement = MockHTMLCanvasElement as unknown as typeof HTMLCanvasElement;
}
