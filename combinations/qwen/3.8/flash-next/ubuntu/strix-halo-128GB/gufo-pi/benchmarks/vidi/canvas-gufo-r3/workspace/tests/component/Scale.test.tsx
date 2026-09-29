import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { TestBoard, HarnessHandle, flushFrames } from './harness';
import { createSticky, snapshot } from '@shared/board-model';

const NOTE_COUNT = 500;

describe('Scale: 500 notes stay interactive', () => {
  afterEach(cleanup);

  it('renders 500 notes and still drags one of them', async () => {
    const handle: HarnessHandle = { current: null };
    const { container } = render(<TestBoard handle={handle} />);
    const doc = handle.current!.doc;

    const start = performance.now();
    act(() => {
      doc.transact(() => {
        for (let i = 0; i < NOTE_COUNT; i++) {
          createSticky(doc, { x: (i % 25) * 220, y: Math.floor(i / 25) * 220 });
        }
      });
    });
    const seedMs = performance.now() - start;

    expect(container.querySelectorAll('[data-testid="sticky-note-wrapper"]').length).toBe(NOTE_COUNT);
    expect(snapshot(doc).length).toBe(NOTE_COUNT);
    // A mid-range laptop should seed and paint 500 notes well inside a frame budget window
    expect(seedMs).toBeLessThan(10_000);

    // Drag the top-most note: pointer delta divided by zoom, rAF-throttled
    const notes = snapshot(doc);
    const target = notes[notes.length - 1];
    const el = container.querySelector(
      `[data-note-id="${target.id}"][data-testid="sticky-note"]`,
    ) as HTMLElement;

    const dragStart = performance.now();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    for (let step = 1; step <= 10; step++) {
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 + step * 5, clientY: 100, button: 0 });
    }
    await act(async () => {
      await flushFrames();
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 100, button: 0 });
    });
    const dragMs = performance.now() - dragStart;

    const moved = snapshot(doc).find((n) => n.id === target.id)!;
    expect(moved.x).toBeCloseTo(target.x + 50, 5);
    // 10 move events across 500 notes must not take seconds
    expect(dragMs).toBeLessThan(2_000);
  });
});
