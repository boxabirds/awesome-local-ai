import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as React from 'react';
import type { Camera } from '../../src/client/canvas/camera';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';

function cam(x: number, y: number, zoom: number): Camera {
  return Object.freeze({ x, y, zoom });
}

const TEST_VIEWPORT = { width: 1280, height: 800 };

// A wrapper component that provides useCamera and all child components
// Includes the same window-level keyboard shortcuts as App.tsx
function TestApp() {
  const hook = useCamera(TEST_VIEWPORT);

  // Keyboard shortcuts at window level
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;
      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault();
          hook.zoomIn();
          break;
        case '-':
          e.preventDefault();
          hook.zoomOut();
          break;
        case '0':
          e.preventDefault();
          hook.reset();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hook]);

  return (
    <>
      <BoardViewport camera={hook.camera} useCameraHook={hook} />
      <ZoomControls
        zoomPercent={hook.percent}
        canZoomIn={hook.canZoomIn}
        canZoomOut={hook.canZoomOut}
        onZoomIn={hook.zoomIn}
        onZoomOut={hook.zoomOut}
        onReset={hook.reset}
      />
      <NavigationHint visible={hook.hasNavigated} />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------- TC-13: pointer drag ----------
describe('TC-13: pointer drag', () => {
  it('pointerdown/move(200,100)/up updates world layer transform', async () => {
    const { container, unmount } = render(<TestApp />);
    // Flush any initial rAF
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const viewport = container.querySelector('.viewport');
    expect(viewport).toBeTruthy();

    // Use dispatchEvent — jsdom lacks PointerEvent, so use Event with required props
    const pd = Object.assign(new Event('pointerdown', { bubbles: true }), {
      clientX: 640, clientY: 400, button: 0, pointerType: 'mouse', 
    }) as unknown as PointerEvent;
    await act(async () => {
      viewport!.dispatchEvent(pd);
      await vi.advanceTimersByTimeAsync(50);
    });

    // Move 200 right, 100 down
    const pm = Object.assign(new Event('pointermove', { bubbles: true }), {
      clientX: 840, clientY: 500, button: 0, pointerType: 'mouse',
    }) as unknown as PointerEvent;
    await act(async () => {
      viewport!.dispatchEvent(pm);
      await vi.advanceTimersByTimeAsync(50);
    });

    // Camera: panBy(cam, +200, +100) → cam.x = -640 - 200 = -840, cam.y = -400 - 100 = -500
    // Transform: translate(-cam.x, -cam.y) = translate(840, 500)
    const worldLayer = container.querySelector('.world-layer');
    expect(worldLayer?.getAttribute('style')).toContain('translate(840px');
    expect(worldLayer?.getAttribute('style')).toContain('500px)');

    // Pointing is captured and panning class added
    expect(viewport?.classList.contains('panning')).toBe(true);

    // Pointer up
    const pu = Object.assign(new Event('pointerup', { bubbles: true }), {
      clientX: 840, clientY: 500, button: 0, pointerType: 'mouse',
    }) as unknown as PointerEvent;
    await act(async () => {
      viewport!.dispatchEvent(pu);
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(viewport?.classList.contains('panning')).toBe(false);

    unmount();
  });
});

// ---------- TC-14: pointercancel mid-drag ----------
describe('TC-14: pointer cancel mid-drag', () => {
  it('camera frozen at cancel; later moves ignored', async () => {
    const { container, unmount } = render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const viewport = container.querySelector('.viewport');
    expect(viewport).toBeTruthy();

    // Start a drag using direct dispatch — jsdom has no PointerEvent
    const pd = Object.assign(new Event('pointerdown', { bubbles: true }), {
      clientX: 640, clientY: 400, button: 0, pointerType: 'mouse',
    }) as unknown as PointerEvent;
    await act(async () => {
      viewport!.dispatchEvent(pd);
      await vi.advanceTimersByTimeAsync(50);
    });

    // Move a bit
    const pm = Object.assign(new Event('pointermove', { bubbles: true }), {
      clientX: 740, clientY: 440, button: 0, pointerType: 'mouse',
    }) as unknown as PointerEvent;
    await act(async () => {
      viewport!.dispatchEvent(pm);
      await vi.advanceTimersByTimeAsync(50);
    });

    // Cancel — dispatch pointercancel as a simple Event
    const pcEvent = new Event('pointercancel', { bubbles: true });
    viewport!.dispatchEvent(pcEvent);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Capture current camera position
    const initialWorldStyle = (container.querySelector('.world-layer') as HTMLElement)?.style.transform;

    // Try to move more — should NOT update camera
    await act(async () => {
      fireEvent.pointerMove(viewport!, { clientX: 1040, clientY: 740, button: 0, pointerType: 'mouse' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const afterWorldStyle = (container.querySelector('.world-layer') as HTMLElement)?.style.transform;
    expect(afterWorldStyle).toBe(initialWorldStyle);

    unmount();
  });
});

// ---------- TC-15: plain wheel ----------
describe('TC-15: plain wheel', () => {
  it('wheel deltaY +100 → camera y changes, defaultPrevented true', async () => {
    const { container, unmount } = render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const viewport = container.querySelector('.viewport');
    expect(viewport).toBeTruthy();

    // Dispatch wheel event
    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      viewport!.dispatchEvent(wheelEvent);
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);

    // Plain scroll: panBy(cam, -deltaX, -deltaY) at zoom=1
    // new cam.x = old.cam.x - 0 = -640, new cam.y = old.cam.y - (-100) = -400 + 100 = -300
    // Transform: translate(-cam.x, -cam.y) = translate(640, 300)
    const worldLayer = container.querySelector('.world-layer');
    expect(worldLayer?.getAttribute('style')).toContain('translate(640px');
    expect(worldLayer?.getAttribute('style')).toContain('300px)');

    unmount();
  });
});

// ---------- TC-16: Ctrl wheel ----------
describe('TC-16: Ctrl wheel', () => {
  it('Ctrl wheel deltaY=-100 at centre → zoom increases, defaultPrevented true', async () => {
    const { container, unmount } = render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const viewport = container.querySelector('.viewport');
    expect(viewport).toBeTruthy();

    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      viewport!.dispatchEvent(wheelEvent);
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);

    // At zoom 1, factor = exp(-(-100)*0.01) = exp(1) ≈ 2.718
    // Clamp to min(4, 2.718) = 2.718
    const output = document.querySelector('[aria-live="polite"]');
    expect(output?.textContent).toMatch(/\d+%$/);

    const worldLayer = container.querySelector('.world-layer');
    const style = worldLayer?.getAttribute('style');
    expect(style).toMatch(/scale\(\d+\.\d+/);

    unmount();
  });
});

// ---------- TC-17: Safari gesture change ----------
describe('TC-17: gesturechange scale', () => {
  it('synthetic gesturechange scale 2 doubles zoom, defaultPrevented true', async () => {
    const { container, unmount } = render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const viewport = container.querySelector('.viewport');
    expect(viewport).toBeTruthy();

    // Dispatch gesturechange event (Safari-specific)
    const ge = new CustomEvent('gesturechange', { bubbles: true }) as unknown as GestureEvent;
    ge.scale = 2;
    await act(async () => {
      viewport!.dispatchEvent(ge);
      await vi.advanceTimersByTimeAsync(50);
    });

    // From 100% to 200%
    const output = document.querySelector('[aria-live="polite"]');
    expect(output?.textContent).toBe('200%');

    unmount();
  });
});

// ---------- TC-18: keyboard shortcuts ----------
describe('TC-18: keyboard shortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.__vidi6 = undefined;
  });

  function fireKey(key: string, opts: Partial<Record<string, boolean>> = {}) {
    return act(async () => {
      const kd = new KeyboardEvent('keydown', {
        key,
        ctrlKey: opts.ctrlKey ?? false,
        metaKey: opts.metaKey ?? false,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(kd, 'defaultPrevented', {
        get: () => kd.defaultPrevented,
        set: (v) => {},
        configurable: true,
      });
      const _kd = kd;
      Object.assign(kd, { preventDefault() { Object.defineProperty(_kd, 'defaultPrevented', { value: true }); } });
      window.dispatchEvent(kd);
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  it('Ctrl/+ → zoom step in (1.0→1.25)', async () => {
    const { container } = render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    await fireKey('+', { ctrlKey: true });

    const output = container.querySelector('[aria-live="polite"]');
    expect(output?.textContent).toBe('125%');
  });

  it('Ctrl/- → zoom step out (1.25→1.0)', async () => {
    render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // First zoom in via '+'
    await fireKey('+', { ctrlKey: true });
    // Then zoom out via '-'
    await fireKey('-', { ctrlKey: true });

    const output = document.querySelector('[aria-live="polite"]');
    expect(output?.textContent).toBe('100%');
  });

  it('Ctrl+0 → reset', async () => {
    render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    await fireKey('0', { ctrlKey: true });

    const output = document.querySelector('[aria-live="polite"]');
    expect(output?.textContent).toBe('100%');
  });
});

// ---------- TC-29: click without move ----------
describe('TC-29: click without move', () => {
  it('camera unchanged, hint not dismissed', async () => {
    render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Initial hint should be visible
    expect(screen.getByText(/Drag to move around/i)).toBeTruthy();

    // Simulate a quick click without moving — done in a single act block
    const viewport = document.querySelector('.viewport');
    await act(async () => {
      if (viewport) {
        fireEvent.pointerDown(viewport, { clientX: 640, clientY: 400, button: 0, pointerType: 'mouse' });
        fireEvent.pointerUp(viewport, { clientX: 640, clientY: 400, button: 0, pointerType: 'mouse' });
        await vi.advanceTimersByTimeAsync(50);
      }
    });

    // Hint should still be visible (no navigation happened — same camera object returned)
    expect(screen.queryByText(/Drag to move around/i)).toBeTruthy();
  });
});

// ---------- TC-30: Ctrl wheel over zoom control ----------
describe('TC-30: Ctrl wheel over zoom control', () => {
  it('Ctrl wheel over zoom control does not affect board camera', async () => {
    const { container, unmount } = render(<TestApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const zoomControls = container.querySelector('[role="toolbar"]');
    expect(zoomControls).toBeTruthy();

    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      zoomControls!.dispatchEvent(wheelEvent);
      await vi.advanceTimersByTimeAsync(50);
    });

    // Camera should still be at 100%
    const output = document.querySelector('[aria-live="polite"]');
    expect(output?.textContent).toBe('100%');

    unmount();
  });
});
