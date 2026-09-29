import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { dispatch, pointerEvent } from './harness';
import { renderApp, flush } from './appHarness';

/**
 * "It must not lag with 500 notes on the board."
 *
 * A millisecond budget asserted in jsdom would be either meaningless or flaky,
 * so the component tests assert the *structure* that makes the budget possible:
 * one commit per click, and a bounded number of writes per drag. The wall-clock
 * half of the promise is measured in a real browser, in tests/e2e/perf.spec.ts.
 */

function grid(count: number) {
  const notes = [];
  for (let index = 0; index < count; index += 1) {
    notes.push({
      x: (index % 25) * 220 - 2000,
      y: Math.floor(index / 25) * 220 - 1200,
      text: `note ${index}`,
    });
  }
  return notes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('render cost with many notes', () => {
  it('renders 500 notes, each at its own place', () => {
    const started = Date.now();
    const harness = renderApp(grid(500));
    const elapsed = Date.now() - started;

    const elements = harness.noteElements();
    expect(elements).toHaveLength(500);
    expect(harness.notes()).toHaveLength(500);
    // No note is stacked at the origin: positions round-tripped from the
    // document into the DOM.
    const lefts = new Set(elements.map((element) => element.style.left));
    expect(lefts.size).toBe(25);
    expect(elapsed).toBeLessThan(5_000);
  });

  it('clicking one note commits once and touches only the two notes involved', async () => {
    const commits: number[] = [];
    // StrictMode off: the double render is a development aid and would double
    // every count here.
    const harness = renderApp(grid(500), {
      strict: false,
      profile: (duration) => commits.push(duration),
    });
    commits.length = 0;

    const victim = harness.notes()[250];
    const neighbour = harness.notes()[251];
    expect(harness.noteElement(victim.id).getAttribute('data-selected')).toBe('false');
    expect(harness.noteElement(neighbour.id).getAttribute('data-selected')).toBe('false');

    const element = harness.noteElement(victim.id);
    const started = Date.now();
    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 400, clientY: 250, buttons: 1 }));
    const elapsed = Date.now() - started;

    expect(harness.noteElement(victim.id).getAttribute('data-selected')).toBe('true');
    // The other 499 were left alone.
    expect(harness.noteElement(neighbour.id).getAttribute('data-selected')).toBe('false');
    expect(commits.length).toBeLessThanOrEqual(3);
    // A loose ceiling, high enough not to depend on the speed of the machine,
    // low enough to catch a full re-render of 500 notes per click.
    expect(elapsed).toBeLessThan(250);
  });

  it('a 20-step drag writes twice at most: raise, then one position per frame', async () => {
    // Frame control, so the count is about the throttle and not about how fast
    // this machine happens to run animation frames.
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });

    const harness = renderApp(grid(200), { strict: false });
    const id = harness.notes()[0].id;
    const element = harness.noteElement(id);
    const start = harness.notes()[0].x;

    let updates = 0;
    // One 'update' per transaction that actually changed something.
    harness.doc.on('update', () => {
      updates += 1;
    });

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    for (let step = 0; step < 20; step += 1) {
      await dispatch(element, pointerEvent('pointermove', { clientX: 400 + step, clientY: 250, buttons: 1 }));
    }
    // Crossing the threshold raised the note; that is the only write so far.
    expect(updates).toBe(1);

    await runFrames(frames);

    // One frame, one write, holding the last point the pointer was seen at.
    expect(updates).toBe(2);
    const moved = harness.notes().find((note) => note.id === id);
    expect(moved?.x).toBeCloseTo(start + 19, 6);
    // The note was also raised above the other 199, which is why it has to be
    // found by id: the paint order changed.
    expect(moved?.z).toBe(201);

    // Releasing without a frame in between changes nothing.
    await dispatch(element, pointerEvent('pointerup', { clientX: 420, clientY: 250, buttons: 1 }));
    expect(updates).toBe(2);
  });

  it('a drag that never gets a frame still ends on the last position', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1); // frames never run

    const harness = renderApp(grid(200), { strict: false });
    const id = harness.notes()[0].id;
    const element = harness.noteElement(id);
    const start = harness.notes()[0].x;

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    for (let step = 0; step < 20; step += 1) {
      await dispatch(element, pointerEvent('pointermove', { clientX: 400 + step, clientY: 250, buttons: 1 }));
    }
    await dispatch(element, pointerEvent('pointerup', { clientX: 420, clientY: 250, buttons: 1 }));
    await flush();

    const moved = harness.notes().find((note) => note.id === id);
    expect(moved?.x).toBeCloseTo(start + 19, 6);
  });
});

/** Run frame callbacks inside act(), so React sees the resulting updates. */
async function runFrames(frames: Array<() => void>): Promise<void> {
  await act(async () => {
    for (const frame of frames.splice(0)) frame();
  });
}
