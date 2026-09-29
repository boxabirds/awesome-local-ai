// Story 11, task 4: component tests for the Stroke object (TC-15, TC-16,
// TC-21): the line-distance hit test at 50% / 200% zoom, the pointer
// fall-through over a sticky inside the bbox, and a remote delete clearing a
// stale selection.
//
// The App is rendered against a mocked connector; jsdom has no CSS hit
// testing, so the hit band's explicit tolerance check (the same contract the
// registry documents) is driven by dispatching on the band element at a known
// screen point under a deterministic camera.

import { act, cleanup, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { createStickyAt, deleteObjects, objectSnapshot } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import {
  resetBoardForTests,
  setBoardCamera as setCam,
} from '../../src/client/canvas/useCamera';
import { makeEvent } from './helpers';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import type { Camera } from '../../src/client/canvas/camera';

const SEED = vi.hoisted(() => ({
  state: 'connected' as ConnectionState,
  doc: null as Y.Doc | null,
  seed: (_doc: Y.Doc): void => undefined,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(SEED.state);
      SEED.doc = doc;
      queueMicrotask(() => {
        if (objectSnapshot(doc).length !== 0) return;
        SEED.seed(doc);
      });
      return { destroy: (): void => undefined };
    },
  };
});

const CAM: Camera = { x: -512, y: -384, zoom: 1 };

function dis(target: EventTarget, type: string, props: Record<string, unknown>): void {
  act(() => {
    target.dispatchEvent(makeEvent(type, props));
  });
}
async function openBoard(): Promise<void> {
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  render(<App />);
  await act(async () => undefined);
  act(() => {
    setCam(CAM);
  });
}
function strokes(): StrokeSnap[] {
  return objectSnapshot(SEED.doc!).filter((o) => o.type === 'stroke') as StrokeSnap[];
}
function strokeSelected(): boolean {
  return screen.queryByTestId('stroke-object')?.getAttribute('data-selected') !== null;
}
/** A press + release on the stroke's hit band at a screen point. */
function clickStrokeAt(x: number, y: number): void {
  const hit = screen.getByTestId('stroke-hit');
  dis(hit, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y });
  dis(window, 'pointerup', { pointerId: 1 });
}
/** An empty-surface click clears the selection. */
function clearSelection(): void {
  const vp = screen.getByTestId('board-viewport');
  dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 700 });
  dis(vp, 'pointerup', { pointerId: 1, clientX: 100, clientY: 700 });
}

describe('story 11: stroke object (TC-15, TC-16, TC-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
    SEED.state = 'connected';
    SEED.doc = null;
    SEED.seed = () => undefined;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('TC-15: the line hit test is a hit at 5 screen px and a miss at 7, at 50% and 200%', async () => {
    // A thin horizontal line from (0,0) to (200,0).
    SEED.seed = (doc) => {
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'red', thickness: 'thin' }, 't');
    };
    await openBoard();

    // 50% zoom, camera (-1024,-768): the line y=0 is at screen y=384; 5px =
    // 10 world units (<= 12 tolerance, hit), 7px = 14 (> 12, miss).
    act(() => setCam({ x: -1024, y: -768, zoom: 0.5 }));
    clickStrokeAt(562, 379); // 5 px above the line
    expect(strokeSelected()).toBe(true);
    clearSelection();
    expect(strokeSelected()).toBe(false);
    clickStrokeAt(562, 377); // 7 px above the line
    expect(strokeSelected()).toBe(false);

    // 200% zoom, camera (-128,-96): the line y=0 is at screen y=192; 5px =
    // 2.5 world units (<= 3 tolerance, hit), 7px = 3.5 (> 3, miss).
    act(() => setCam({ x: -128, y: -96, zoom: 2 }));
    clearSelection();
    clickStrokeAt(456, 187); // 5 px above the line
    expect(strokeSelected()).toBe(true);
    clearSelection();
    clickStrokeAt(456, 185); // 7 px above the line
    expect(strokeSelected()).toBe(false);
  });

  it('TC-16: a click inside the bbox but far from the line falls through to a sticky beneath', async () => {
    let noteId = '';
    SEED.seed = (doc) => {
      // A rectangle loop (0,0)-(200,200): the bbox covers the centre, but the
      // line runs around the perimeter, ~50 units from the centre.
      createStroke(
        doc,
        {
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
            { x: 0, y: 0 },
          ],
          color: 'red',
          thickness: 'thin',
        },
        't',
      );
      noteId = createStickyAt(doc, 100, 100, 'yellow') as string; // covers (100..300, 100..300)
    };
    await openBoard();

    // World (150,150) = screen (662,534) at the default camera: inside the
    // stroke bbox, ~50 units from the line, and on the sticky.
    const x = 662;
    const y = 534;
    // The stroke does not catch the click (far from the line).
    clickStrokeAt(x, y);
    expect(strokeSelected()).toBe(false);

    // The click lands on the sticky beneath (it is selected).
    const note = document.querySelector(`[data-note-id="${noteId}"]`) as HTMLElement;
    dis(note, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y });
    dis(window, 'pointerup', { pointerId: 1 });
    expect(note.getAttribute('data-selected')).not.toBeNull();
    expect(strokeSelected()).toBe(false);
  });

  it('TC-21: a remote delete of a selected stroke clears the selection without error', async () => {
    let strokeId = '';
    SEED.seed = (doc) => {
      strokeId = createStroke(
        doc,
        { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'red', thickness: 'medium' },
        't',
      ) as string;
    };
    await openBoard();

    // Select the stroke by clicking the line (world (100,0) = screen (612,384)).
    clickStrokeAt(612, 384);
    expect(strokeSelected()).toBe(true);

    // A remote delete removes the object; the stale selection id is pruned.
    act(() => {
      deleteObjects(SEED.doc!, [strokeId]);
    });
    expect(screen.queryByTestId('stroke-object')).toBeNull();
    expect(strokes()).toHaveLength(0);
  });
});
