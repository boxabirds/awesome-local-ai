import { describe, expect, it } from 'vitest';
import { computeKeyboardInset } from '@/lib/useKeyboardInset';

describe('computeKeyboardInset', () => {
  it('TC-93 innerHeight 800, visualViewport height 500 and offsetTop 0 -> 300', () => {
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: { height: 500, offsetTop: 0 } })).toBe(300);
  });

  it('TC-93 no visualViewport -> 0', () => {
    expect(computeKeyboardInset({ innerHeight: 800 })).toBe(0);
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: null })).toBe(0);
  });

  it('subtracts the viewport offset and never goes below 0', () => {
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: { height: 500, offsetTop: 100 } })).toBe(200);
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: { height: 800, offsetTop: 40 } })).toBe(0);
  });
});
