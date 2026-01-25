/**
 * Mock JSZip class
 */
export class MockJSZip {
  file(): this {
    return this;
  }

  async generateAsync(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

/**
 * Setup JSZip mock globally
 */
export function setupJSZipMock(): void {
  // Use type assertion to assign to global.JSZip
  (global as unknown as { JSZip: typeof JSZip }).JSZip = MockJSZip as unknown as typeof JSZip;
}
