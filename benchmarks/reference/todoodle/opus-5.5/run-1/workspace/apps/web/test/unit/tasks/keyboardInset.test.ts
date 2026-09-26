import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { computeKeyboardInset, useKeyboardInset } from '@/lib/useKeyboardInset';

describe('TC-93 keyboard inset', () => {
  it('is innerHeight - visualViewport.height - offsetTop: 800 - 500 - 0 = 300', () => {
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: { height: 500, offsetTop: 0 } })).toBe(300);
  });

  it('accounts for a scrolled visual viewport and never goes negative', () => {
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: { height: 500, offsetTop: 100 } })).toBe(200);
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: { height: 850, offsetTop: 0 } })).toBe(0);
  });

  it('is 0 when the browser has no visualViewport', () => {
    expect(computeKeyboardInset({ innerHeight: 800 })).toBe(0);
    expect(computeKeyboardInset({ innerHeight: 800, visualViewport: null })).toBe(0);
  });

  it('the hook writes --kb-inset once per frame while active and clears it on close', () => {
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 500,
      offsetTop: 0,
      addEventListener: vi.fn((type: string, fn: () => void, opts: AddEventListenerOptions) => {
        expect(opts).toEqual({ passive: true });
        listeners.set(type, fn);
      }),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    };
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 800);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const hook = renderHook(({ active }) => useKeyboardInset(active), { initialProps: { active: true } });
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('300px');

    viewport.height = 450;
    listeners.get('resize')!();
    listeners.get('scroll')!();
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('350px');

    hook.rerender({ active: false });
    expect(listeners.size).toBe(0);
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('');
  });
});
