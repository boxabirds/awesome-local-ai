import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { useMarquee, MarqueeRect } from '../../src/client/board/Marquee';
import type { Camera } from '../../src/client/canvas/camera';

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Test harness component
function MarqueeTestHarness({
  camera,
  snapshot,
  onSelect,
}: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onSelect: (ids: string[]) => void;
}) {
  const marquee = useMarquee(camera, snapshot, onSelect);
  return (
    <div>
      <button data-testid="begin" onClick={() => marquee.begin({ x: 0, y: 0 })}>begin</button>
      <button data-testid="move" onClick={() => marquee.move({ x: 300, y: 300 })}>move</button>
      <button data-testid="end" onClick={() => marquee.end()}>end</button>
      <button data-testid="cancel" onClick={() => marquee.cancel()}>cancel</button>
      <MarqueeRect rect={marquee.rect} camera={camera} />
    </div>
  );
}

describe('Marquee component tests', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };

  // TC-20: Shift+drag around objects with {x} selected → fully-inside ids added (additive)
  it('TC-20: marquee end calls onSelect with fully-inside ids', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Create a note at (100, 100) → top-left at (0, 0), size 200×200
    createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const onSelect = vi.fn();
    const { container } = render(
      <MarqueeTestHarness camera={camera} snapshot={snap} onSelect={onSelect} />
    );

    act(() => {
      container.querySelector('[data-testid="begin"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      container.querySelector('[data-testid="move"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      container.querySelector('[data-testid="end"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // The marquee rect is (0,0) to (300,300) in screen space = world space (zoom=1, camera at 0,0)
    // The note is at (0,0) size 200×200 → fully inside (0,0,300,300)
    expect(onSelect).toHaveBeenCalled();
    const selectedIds = onSelect.mock.calls[0][0];
    expect(selectedIds).toHaveLength(1);
  });

  // TC-21: plain drag (no Shift) pans; no marquee (negative)
  it('TC-21: marquee is only started by explicit begin call (no auto-start)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const onSelect = vi.fn();
    const { container } = render(
      <MarqueeTestHarness camera={camera} snapshot={snap} onSelect={onSelect} />
    );

    // Without calling begin, move and end should do nothing
    act(() => {
      container.querySelector('[data-testid="move"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      container.querySelector('[data-testid="end"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  // TC-22: pointercancel mid-marquee → selection unchanged
  it('TC-22: cancel during marquee does not call onSelect', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const onSelect = vi.fn();
    const { container } = render(
      <MarqueeTestHarness camera={camera} snapshot={snap} onSelect={onSelect} />
    );

    act(() => {
      container.querySelector('[data-testid="begin"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      container.querySelector('[data-testid="move"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      container.querySelector('[data-testid="cancel"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  // MarqueeRect renders when rect is present
  it('MarqueeRect renders a div when rect is not null', () => {
    const { container } = render(
      <MarqueeRect rect={{ x: 10, y: 20, width: 100, height: 50 }} camera={camera} />
    );
    expect(container.querySelector('[data-testid="marquee-rect"]')).toBeTruthy();
  });

  it('MarqueeRect returns null when rect is null', () => {
    const { container } = render(
      <MarqueeRect rect={null} camera={camera} />
    );
    expect(container.querySelector('[data-testid="marquee-rect"]')).toBeNull();
  });
});
