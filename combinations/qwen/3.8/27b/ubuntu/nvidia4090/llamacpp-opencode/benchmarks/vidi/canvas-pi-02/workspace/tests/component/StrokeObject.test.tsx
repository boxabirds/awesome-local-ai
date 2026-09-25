import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, snapshot } from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import { createStroke } from '../../src/shared/objects/stroke';
import { HANDWRITTEN_LOOP } from '../fixtures/pen-paths';
import { createNote, renderNotesHarness } from './notes-harness';
import { enableFakeFrameTimers } from './test-utils';

/**
 * Story 11 stroke.object component tests (task 5, TC-15, TC-16 and TC-21):
 * the zoom-aware hit test, click-through of the stroke overlay onto objects
 * underneath, and deleting a selected stroke through the model.
 *
 * Coordinate model: 1280x800 viewport, home camera {-640, -400, 1}, so
 * screen = world + (640, 400).
 */
const PID = 1;
const sc = (wx: number, wy: number) => ({ clientX: wx + 640, clientY: wy + 400 });

const strokeSpec = () => getObjectType('stroke')!;

const strokes = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'stroke');

beforeEach(() => {
  enableFakeFrameTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('stroke.object (TC-15, TC-16, TC-21)', () => {
  it('TC-15 the hit tolerance is 5 screen px at any zoom (7 px never hits): 5 px hits and 7 px misses at 50%, 100% and 200%', () => {
    const doc = new Y.Doc();
    act(() => {
      createStroke(
        doc,
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
        'u1',
      );
    });
    const snap = snapshot(doc)[0]! as ObjectSnapshot;
    const hit = strokeSpec().hitTest!;
    expect(hit).toBeTruthy();

    // 5 screen px == 10 world units at 50% — inside; 7 px == 14 world — outside.
    expect(hit!(snap, { x: 50, y: 10 }, 0.5)).toBe(true);
    expect(hit!(snap, { x: 50, y: 14 }, 0.5)).toBe(false);
    // 100%: 5 px == 5 world — inside; 7 px == 7 world — outside.
    expect(hit!(snap, { x: 50, y: 5 }, 1)).toBe(true);
    expect(hit!(snap, { x: 50, y: 7 }, 1)).toBe(false);
    // 200%: 5 px == 2.5 world — inside; 7 px == 3.5 world — outside.
    expect(hit!(snap, { x: 50, y: 2.5 }, 2)).toBe(true);
    expect(hit!(snap, { x: 50, y: 3.5 }, 2)).toBe(false);
  });

  it('TC-16 the stroke renders above the sticky but is click-through: a click in the empty centre selects only the sticky', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const stickyId = createNote(doc, 0, 0);
    let strokeId = '';
    act(() => {
      strokeId = createStroke(doc, { points: HANDWRITTEN_LOOP, color: 'purple', thickness: 'medium' }, 'u1') ?? '';
    });

    // The stroke is rendered (above the sticky in document order) with a
    // pointer-transparent container and an invisible fat hit path (the first
    // path; the visible pen line is the second).
    const container = screen.getByTestId('stroke-object');
    expect(container.style.pointerEvents).toBe('none');
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBe(2);
    const hitPath = paths[0]!;
    expect(hitPath.getAttribute('fill')).toBe('none');
    expect(Number(hitPath.getAttribute('stroke-width'))).toBeGreaterThan(0);
    // The visible line is pointer-transparent; only the hit path listens.
    const visible = paths[1]!;
    expect(visible.getAttribute('stroke-width')).toBeTruthy();

    // The sticky sits at the origin; its centre (world 0,0) is inside the
    // loop's bbox but far from the drawn line. Click there.
    const sticky = screen.getAllByRole('group', { name: 'Sticky note' })[0]!;
    fireEvent.pointerDown(sticky, { button: 0, pointerId: PID, ...sc(0, 0) });
    fireEvent.pointerUp(window, { pointerId: PID, ...sc(0, 0) });

    const sel = selectionRef.current!;
    expect(sel.ids.has(stickyId)).toBe(true);
    expect(sel.ids.has(strokeId)).toBe(false);

    // A click at the centre selects the sticky below — it would not happen
    // if the stroke container swallowed pointer events.
  });

  it('TC-21 a stroke deleted through the model while selected: no exception, the selection clears and the overlay unmounts', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    let strokeId = '';
    act(() => {
      strokeId =
        createStroke(
          doc,
          { points: [{ x: -50, y: -20 }, { x: 50, y: 20 }], color: 'blue', thickness: 'thick' },
          'u1',
        ) ?? '';
    });

    // Select the stroke (as a line click would).
    act(() => {
      selectionRef.current!.click(strokeId);
    });
    expect(selectionRef.current!.ids.has(strokeId)).toBe(true);
    expect(screen.getByTestId('stroke-object')).toBeTruthy();

    // Delete through the model (e.g. a remote peer or the selection bar).
    let threw = false;
    act(() => {
      try {
        deleteObjects(doc, [strokeId]);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(selectionRef.current!.ids.size).toBe(0);
    expect(screen.queryByTestId('stroke-object')).toBeNull();
    expect(strokes(doc)).toHaveLength(0);
  });
});
