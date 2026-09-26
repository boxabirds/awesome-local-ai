import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { App } from '../../src/client/App';

import {
  fire,
  pressKey,
  pointerEvent,
  pointerEventEx,
  seed,
  seedCluster,
  selectedIds,
  selectAll,
  setCamera,
} from './harness';

/**
 * Story 7 — select, move, resize and delete several objects at once.
 *
 * Two render trees, as the design requires:
 *  - a five-object default board (two rows, 60px gaps) with no ResizeObserver,
 *    driven through the marquee and the bounding box, at 100% zoom and zoom 2;
 *  - a one-sticky tree for the single-object regressions.
 */

/** Five notes in two rows with 60px gaps: three at y 100, two at y 360. */
const FIVE: Array<[number, number]> = [
  [100, 100],
  [360, 100],
  [620, 100],
  [100, 360],
  [360, 360],
];

interface Hook {
  snapshot(): Array<{ id: string; x: number; y: number; width: number; height: number }>;
}

function hook(): Hook {
  return (window as unknown as { __vidi6: Hook }).__vidi6;
}

function board() {
  return hook().snapshot();
}

function viewport(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (!el) throw new Error('no viewport');
  return el;
}

/** Shift+drag. `leaveBoard` cancels the rectangle by leaving the board first. */
function dragMarquee(
  from: [number, number],
  to: [number, number],
  opts: { onNote?: HTMLElement; leaveBoard?: boolean } = {},
): void {
  const start = opts.onNote ?? viewport();
  fire(start, pointerEventEx('pointerdown', from[0], from[1], { shift: true }));
  const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  fire(viewport(), pointerEventEx('pointermove', mid[0], mid[1], { shift: true }));
  if (opts.leaveBoard) {
    // Pointer leaves the board, then is released: the rectangle must not act.
    fire(viewport(), new MouseEvent('pointerleave', { bubbles: false, clientX: to[0], clientY: to[1] }));
    fire(document.body, pointerEventEx('pointerup', to[0], to[1], { shift: true }));
    return;
  }
  fire(viewport(), pointerEventEx('pointermove', to[0], to[1], { shift: true }));
  fire(viewport(), pointerEventEx('pointerup', to[0], to[1], { shift: true }));
}

function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} is gone`);
  return el;
}

beforeEach(() => {
  cleanup();
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});

describe('TC-33 the selection frame does not occlude content', () => {
  for (const zoom of [1, 2]) {
    it(`draws one frame around the group at zoom ${zoom}`, () => {
      const { container } = render(<App />);
      seedCluster(FIVE);
      setCamera(0, 0, zoom);
      selectAll();
      expect(selectedIds()).toHaveLength(5);

      const frames = container.querySelectorAll<HTMLElement>('[data-testid="selection-box"]');
      // One frame for five objects — four notes are one group, not four choices.
      expect(frames).toHaveLength(1);
      const frame = frames[0];
      // It surrounds the objects instead of covering them: the frame itself
      // takes no pointer events, so a click inside it still reaches a note.
      expect(frame.style.pointerEvents).toBe('none');
      // Its box is the group's bounds scaled by the camera (read from the
      // inline style: jsdom has no layout engine, so getBoundingClientRect is
      // always zero-width there).
      expect(parseFloat(frame.style.width)).toBeCloseTo(720 * zoom, 1);
      expect(parseFloat(frame.style.height)).toBeCloseTo(460 * zoom, 1);
      // The notes sit inside it, so nothing of a note is hidden behind an
      // opaque panel: the bar is placed beyond the frame's right edge.
      const bar = container.querySelector<HTMLElement>('[data-testid="selection-bar"]');
      expect(bar).not.toBeNull();
      expect(parseFloat(bar!.style.left)).toBeGreaterThan(parseFloat(frame.style.left) + parseFloat(frame.style.width));
    });

    it(`a click inside the frame still reaches the note under it at zoom ${zoom}`, () => {
      render(<App />);
      const ids = seedCluster(FIVE);
      setCamera(0, 0, zoom);
      selectAll();
      // Re-selecting a single note through the frame area keeps working.
      const target = noteEl(ids[2]);
      fire(target, pointerEvent('pointerdown', 500, 300));
      fire(target, pointerEvent('pointerup', 500, 300));
      expect(selectedIds()).toEqual([ids[2]]);
    });
  }
});

describe('the bounding box offers eight handles', () => {
  for (const zoom of [1, 2]) {
    it(`four corners and four edges at zoom ${zoom}`, () => {
      render(<App />);
      seedCluster(FIVE);
      setCamera(0, 0, zoom);
      selectAll();
      const handles = screen.getAllByTestId(/^handle-/);
      expect(handles).toHaveLength(8);
      const corners = handles.filter((h) => /corner$/.test(h.getAttribute('aria-label') ?? ''));
      const edges = handles.filter((h) => /edge$/.test(h.getAttribute('aria-label') ?? ''));
      expect(corners).toHaveLength(4);
      expect(edges).toHaveLength(4);
      // Every handle is announced by name, and keeps its size on screen (they
      // are laid out in screen space, not in the world layer).
      for (const handle of handles) {
        expect(handle.getAttribute('aria-label')).toMatch(/^Resize /);
        expect(handle.style.width).toBe('8px');
      }
    });
  }
});

describe('group delete', () => {
  for (const zoom of [1, 2]) {
    it(`the bar's single control removes the whole selection at zoom ${zoom}`, () => {
      render(<App />);
      seedCluster(FIVE);
      setCamera(0, 0, zoom);
      selectAll();
      const bar = screen.getByTestId('selection-bar');
      expect(bar.getAttribute('aria-label')).toBe('5 selected');
      fireEvent.click(screen.getByTestId('selection-delete'));
      expect(board()).toHaveLength(0);
      expect(selectedIds()).toHaveLength(0);
    });

    it(`Delete removes the group in ONE undo step at zoom ${zoom}`, () => {
      render(<App />);
      seedCluster(FIVE);
      setCamera(0, 0, zoom);
      selectAll();
      pressKey('Delete');
      // One key press removes all five, in one operation, and clears the
      // selection: no second press is needed to finish the group.
      expect(board()).toHaveLength(0);
      expect(selectedIds()).toHaveLength(0);
    });
  }
});

describe('marquee', () => {
  for (const zoom of [1, 2]) {
    it(`selects what it crosses, on release, at zoom ${zoom}`, () => {
      render(<App />);
      seedCluster(FIVE);
      setCamera(0, 0, zoom);
      // A rectangle covering the whole cluster from empty space.
      // A rectangle covering the whole cluster, from empty space.
      setCamera(-20, -20, zoom);
      dragMarquee([5, 5], [900 * zoom, 620 * zoom]);
      expect(selectedIds()).toHaveLength(5);
    });

    it(`still draws when it starts on top of a note, at zoom ${zoom}`, () => {
      const { container } = render(<App />);
      const ids = seedCluster(FIVE);
      setCamera(0, 0, zoom);
      // Starts on the top-left note and sweeps across the rest of the cluster.
      setCamera(-20, -20, zoom);
      // Begins on the top-left note (its corner is at world 0,0) and sweeps
      // across the rest of the cluster.
      dragMarquee([20 * zoom, 20 * zoom], [860 * zoom, 600 * zoom], { onNote: noteEl(ids[0]) });
      expect(container.querySelector('[data-testid="marquee"]')).toBeNull(); // finished
      expect(selectedIds().length).toBeGreaterThan(1);
    });

    it(`does not act when it is released off the board, at zoom ${zoom}`, () => {
      render(<App />);
      seedCluster(FIVE);
      setCamera(0, 0, zoom);
      setCamera(-20, -20, zoom);
      selectAll();
      const before = selectedIds();
      dragMarquee([5, 5], [1600 * zoom, 900 * zoom], { leaveBoard: true });
      expect(selectedIds()).toEqual(before);
    });
  }
});

describe('the single-sticky tree', () => {
  for (const zoom of [1, 2]) {
    it(`keeps one selected note on the per-note path at zoom ${zoom}`, () => {
      const { container } = render(<App />);
      const id = seed(400, 400);
      setCamera(0, 0, zoom);
      const el = noteEl(id);
      fire(el, pointerEvent('pointerdown', 400, 400));
      fire(el, pointerEvent('pointerup', 400, 400));
      expect(selectedIds()).toEqual([id]);
      // A lone note keeps its colour toolbar; the group frame is not drawn.
      expect(container.querySelector('[data-testid="selection-box"]')).toBeNull();
      expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();
    });
  }
});
