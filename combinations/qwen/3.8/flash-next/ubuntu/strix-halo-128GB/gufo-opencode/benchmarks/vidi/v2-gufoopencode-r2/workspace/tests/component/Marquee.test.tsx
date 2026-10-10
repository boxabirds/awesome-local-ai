// TC-20 to TC-22: Shift+drag marquee selection, the negative plain-drag
// pan case, and cancellation mid-marquee.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import {
  App,
  createNote,
  flush,
  noteEl,
  pressAndRelease,
  readCamera,
} from './stickyHelpers';
import { dragPath } from './selectionHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const viewportEl = () => screen.getByTestId('board-viewport');

function shiftMarquee(from: [number, number], to: [number, number]): void {
  const vp = viewportEl();
  fireEvent.pointerDown(vp, { pointerId: 1, clientX: from[0], clientY: from[1], shiftKey: true });
  fireEvent.pointerMove(vp, { pointerId: 1, clientX: to[0], clientY: to[1], shiftKey: true });
  flush();
  fireEvent.pointerUp(vp, { pointerId: 1, clientX: to[0], clientY: to[1], shiftKey: true });
  flush();
}

describe('marquee selection', () => {
  it('TC-20: Shift+drag adds fully enclosed objects to the existing selection', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0); // selected first
    const b = createNote(2000, 2000); // only reachable by marquee
    pressAndRelease(noteEl(a));
    expect(noteEl(a).getAttribute('data-selected')).toBe('true');
    expect(noteEl(b).getAttribute('data-selected')).toBe('false');

    shiftMarquee([2630, 2390], [2850, 2610]);

    expect(noteEl(a).getAttribute('data-selected')).toBe('true'); // additive
    expect(noteEl(b).getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    // The marquee rectangle is gone once the gesture ends.
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  it('TC-21: a plain (no Shift) drag pans and never shows a marquee', () => {
    render(<App />);
    flush();
    createNote(2000, 2000);

    dragPath(viewportEl(), [
      [400, 300],
      [300, 200],
    ]);

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(screen.queryByText('1 selected')).toBeNull();
    // The camera moved (story 1 pan path intact).
    expect(readCamera().x).not.toBe(0);
  });

  it('TC-22: pointercancel mid-marquee leaves the selection unchanged', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    const b = createNote(2000, 2000);
    pressAndRelease(noteEl(a));

    const vp = viewportEl();
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 2630, clientY: 2390, shiftKey: true });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 2850, clientY: 2610, shiftKey: true });
    flush();
    expect(screen.getByTestId('marquee-rect')).toBeInTheDocument();

    fireEvent.pointerCancel(vp, { pointerId: 1, clientX: 2850, clientY: 2610 });
    flush();

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(noteEl(a).getAttribute('data-selected')).toBe('true');
    expect(noteEl(b).getAttribute('data-selected')).toBe('false');
    expect(screen.queryByText('2 selected')).toBeNull();
  });
});
