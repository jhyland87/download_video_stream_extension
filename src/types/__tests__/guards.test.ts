import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isHTMLElement,
  isHTMLDivElement,
  isHTMLButtonElement
} from '../guards.js';

/**
 * Unit tests for DOM element type guards
 */

describe('isHTMLElement', () => {
  it('should return true for HTMLElement instances', () => {
    const element = document.createElement('div');
    expect(isHTMLElement(element)).toBe(true);
  });

  it('should return true for various HTML elements', () => {
    expect(isHTMLElement(document.createElement('div'))).toBe(true);
    expect(isHTMLElement(document.createElement('span'))).toBe(true);
    expect(isHTMLElement(document.createElement('button'))).toBe(true);
    expect(isHTMLElement(document.createElement('input'))).toBe(true);
  });

  it('should return false for null', () => {
    expect(isHTMLElement(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isHTMLElement(undefined)).toBe(false);
  });

  it('should return false for non-element values', () => {
    expect(isHTMLElement({})).toBe(false);
    expect(isHTMLElement([])).toBe(false);
    expect(isHTMLElement('string')).toBe(false);
    expect(isHTMLElement(123)).toBe(false);
    expect(isHTMLElement(true)).toBe(false);
  });

  it('should return false for document fragments', () => {
    const fragment = document.createDocumentFragment();
    expect(isHTMLElement(fragment)).toBe(false);
  });

  it('should return false for text nodes', () => {
    const textNode = document.createTextNode('text');
    expect(isHTMLElement(textNode)).toBe(false);
  });
});

describe('isHTMLDivElement', () => {
  it('should return true for HTMLDivElement instances', () => {
    const div = document.createElement('div');
    expect(isHTMLDivElement(div)).toBe(true);
  });

  it('should return false for other HTML elements', () => {
    expect(isHTMLDivElement(document.createElement('span'))).toBe(false);
    expect(isHTMLDivElement(document.createElement('button'))).toBe(false);
    expect(isHTMLDivElement(document.createElement('input'))).toBe(false);
  });

  it('should return false for null', () => {
    expect(isHTMLDivElement(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isHTMLDivElement(undefined)).toBe(false);
  });

  it('should return false for non-element values', () => {
    expect(isHTMLDivElement({})).toBe(false);
    expect(isHTMLDivElement([])).toBe(false);
    expect(isHTMLDivElement('string')).toBe(false);
    expect(isHTMLDivElement(123)).toBe(false);
  });

  it('should return false for HTMLElement that is not a div', () => {
    const span = document.createElement('span');
    expect(isHTMLElement(span)).toBe(true); // Is HTMLElement
    expect(isHTMLDivElement(span)).toBe(false); // But not HTMLDivElement
  });
});

describe('isHTMLButtonElement', () => {
  it('should return true for HTMLButtonElement instances', () => {
    const button = document.createElement('button');
    expect(isHTMLButtonElement(button)).toBe(true);
  });

  it('should return false for other HTML elements', () => {
    expect(isHTMLButtonElement(document.createElement('div'))).toBe(false);
    expect(isHTMLButtonElement(document.createElement('span'))).toBe(false);
    expect(isHTMLButtonElement(document.createElement('input'))).toBe(false);
  });

  it('should return false for null', () => {
    expect(isHTMLButtonElement(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isHTMLButtonElement(undefined)).toBe(false);
  });

  it('should return false for non-element values', () => {
    expect(isHTMLButtonElement({})).toBe(false);
    expect(isHTMLButtonElement([])).toBe(false);
    expect(isHTMLButtonElement('string')).toBe(false);
    expect(isHTMLButtonElement(123)).toBe(false);
  });

  it('should return false for HTMLElement that is not a button', () => {
    const div = document.createElement('div');
    expect(isHTMLElement(div)).toBe(true); // Is HTMLElement
    expect(isHTMLButtonElement(div)).toBe(false); // But not HTMLButtonElement
  });

  it('should return true for input type="button"', () => {
    const input = document.createElement('input');
    input.type = 'button';
    // Note: input type="button" is not HTMLButtonElement
    // This test verifies the guard correctly distinguishes button elements
    expect(isHTMLButtonElement(input)).toBe(false);
    expect(isHTMLElement(input)).toBe(true);
  });
});
