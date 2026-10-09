/**
 * Story 7 component tests (TC-16 to TC-31): selection bar, marquee, the
 * transform gesture and keyboard commands. A real Y.Doc drives the board; the
 * test-only `testbox` type proves the behaviour is generic, not sticky-specific.
 *
 * Camera is pinned to (0,0,1) so world units equal screen pixels, making the
 * pointer coordinates in these tests the world coordinates directly.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import {
  allObjectIds,
  createSticky,
  deleteObjects,
  initDoc,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { SelectionApi } from '../../src/client/board/useSelection';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { renderBoard } from './board-harness';
import { createTestbox } from '../fixtures/testbox';

// Quiet provider: the board "connects" (editable) unless a test sets the
// global mock state to another connection state.
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    onState((globalThis as unknown as Record<string, string>).__vidi6_conn_state ?? 'connected');
    return { destroy() {} };
  },
}));

let h: ReturnType<typeof renderBoard>;

beforeEach(() => {
  h = renderBoard();
  h.setCamera(0, 0, 1);
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, string>).__vidi6_conn_state;
  cleanup();
});

const viewport = () => h.container.querySelector('.board-viewport') as HTMLElement;
const noteEl = (id: string) => h.container.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const boxEl = (id: string) => h.container.querySelector(`[data-object-id="${id}"][data-testbox]`) as HTMLElement;
const selCount = (): number => h.container.querySelectorAll('[data-selected="true"]').length;

/** pointerdown on `el` at world (x,y) then pointerup on window (a click). */
function clickAt(el: Element, x: number, y: number, shift = false): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, shiftKey: shift });
  fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1 });
}
/** Full drag of an object: down at (x1,y1), one move to (x2,y2), up. */
function dragOn(el: Element, x1: number, y1: number, x2: number, y2: number): void {
  fireEvent.pointerDown(el, { clientX: x1, clientY: y1, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: x2, clientY: y2, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: x2, clientY: y2, pointerId: 1 });
}

// ---------------------------------------------------------------------------
// sel.interaction (SelectionBar, useSelection)
// ---------------------------------------------------------------------------
describe('sel.interaction', () => {
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    let a = '';
    let b = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
      b = createSticky(doc, { x: 400, y: 100 });
    });
    // Select both.
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 500, 200, true);
    expect(selCount()).toBe(2);

    // A colleague deletes both (remote origin): the snapshot prunes them.
    h.seed((doc) => {
      deleteObjects(doc, [a, b]);
    });
    expect(selCount()).toBe(0);
    expect(h.container.querySelector('[data-selection-bar]')).toBeNull();
    expect(screen.queryAllByRole('group', { name: 'Sticky note' })).toHaveLength(0);
  });

  it('TC-17: two selected → "2 selected" + Delete selection; aria-live count', () => {
    let a = '';
    let b = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
      b = createSticky(doc, { x: 400, y: 100 });
    });
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 500, 200, true);

    const bar = h.container.querySelector('[data-selection-bar]') as HTMLElement;
    expect(bar).not.toBeNull();
    const live = bar.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).not.toBeNull();
    expect(live.textContent).toBe('2 selected');
    expect(within(bar).getByRole('button', { name: 'Delete selection' })).toBeTruthy();

    // Deleting via the bar removes both and clears the selection.
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete selection' }));
    expect(snapshot(h.doc).length).toBe(0);
    expect(h.container.querySelector('[data-selection-bar]')).toBeNull();
  });

  it('TC-18: one sticky selected → NoteToolbar (colour/delete), not the bar', () => {
    let a = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
    });
    clickAt(noteEl(a), 200, 200);

    // No multi-selection bar for a single object.
    expect(h.container.querySelector('[data-selection-bar]')).toBeNull();
    // The sticky's own toolbar is shown instead.
    const toolbar = noteEl(a).querySelector('[data-note-toolbar], .note-toolbar, [role="toolbar"]');
    expect(toolbar).not.toBeNull();
  });

  it('TC-19: empty-space click without drag clears the selection', () => {
    let a = '';
    let b = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
      b = createSticky(doc, { x: 400, y: 100 });
    });
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 500, 200, true);
    expect(selCount()).toBe(2);

    // A plain click on empty space (no movement) clears.
    fireEvent.pointerDown(viewport(), { clientX: 10, clientY: 600, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { clientX: 10, clientY: 600, pointerId: 1 });
    expect(selCount()).toBe(0);
    expect(h.container.querySelector('[data-selection-bar]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sel.marquee_ui (useMarquee)
// ---------------------------------------------------------------------------
describe('sel.marquee_ui', () => {
  function seedABC(): [string, string, string] {
    let a = '';
    let b = '';
    let c = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 }); // (100,100)-(300,300)
      b = createSticky(doc, { x: 250, y: 100 }); // (250,100)-(450,300): half in
      c = createSticky(doc, { x: 600, y: 100 }); // (600,100)-(800,300): outside
    });
    return [a, b, c];
  }
  // Marquee rect (50,50)-(400,350): contains A fully, B partly, C not at all.
  function marquee(): void {
    const vp = viewport();
    fireEvent.pointerDown(vp, { clientX: 50, clientY: 50, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(vp, { clientX: 400, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 400, clientY: 350, pointerId: 1 });
  }

  it('TC-20: Shift+drag adds fully-inside ids to the existing selection', () => {
    let x = '';
    h.seed((doc) => {
      x = createSticky(doc, { x: 1000, y: 100 }); // outside the marquee
    });
    const [a] = seedABC();
    // Pre-select X.
    clickAt(noteEl(x), 1100, 200);
    expect(selCount()).toBe(1);

    marquee();
    // X kept (additive) + A added.
    const ids = [...h.container.querySelectorAll('[data-selected="true"]')].map((el) =>
      el.getAttribute('data-object-id') ?? el.getAttribute('data-note-id'),
    );
    expect(ids.sort()).toEqual([a, x].sort());
    expect(selCount()).toBe(2);
  });

  it('TC-21: plain drag on empty space pans; no marquee (negative)', () => {
    let a = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
    });
    clickAt(noteEl(a), 200, 200); // pre-select so we can confirm it is not cleared
    const world = h.container.querySelector('.world-layer') as HTMLElement;
    const before = world.style.transform;

    const vp = viewport();
    fireEvent.pointerDown(vp, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 110, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 110, clientY: 10, pointerId: 1 });

    expect(world.style.transform).not.toBe(before); // camera panned
    expect(h.container.querySelector('[data-marquee]')).toBeNull(); // no marquee
    expect(selCount()).toBe(1); // selection not cleared by a pan
  });

  it('TC-22: pointercancel mid-marquee leaves the selection unchanged', () => {
    let a = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
    });
    clickAt(noteEl(a), 200, 200); // {a}
    const vp = viewport();
    fireEvent.pointerDown(vp, { clientX: 50, clientY: 50, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(vp, { clientX: 400, clientY: 350, pointerId: 1 });
    fireEvent.pointerCancel(vp, { clientX: 400, clientY: 350, pointerId: 1 });

    expect(selCount()).toBe(1); // still just {a}
    expect(h.container.querySelector('[data-marquee]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sel.transform (useTransformGesture, SelectionOverlay)
// ---------------------------------------------------------------------------

/** Isolated harness: mounts useTransformGesture directly with spies. */
function renderGesture(
  doc: Y.Doc,
  snap: readonly ObjectSnapshot[],
  opts: { initialIds?: string[]; canEdit?: boolean } = {},
) {
  const startSpy = vi.fn();
  const endSpy = vi.fn();
  // Mutable selection backing store (SelectionApi.ids is read-only).
  const selState = { ids: new Set<string>(opts.initialIds ?? []) };
  const selection = {
    get ids(): ReadonlySet<string> {
      return selState.ids;
    },
    editingId: null,
    click: vi.fn((id: string) => {
      selState.ids = new Set([id]);
    }),
    toggle: vi.fn((id: string) => {
      const ids = new Set(selState.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      selState.ids = ids;
    }),
    setMany: vi.fn(),
    clear: vi.fn(),
    startEdit: vi.fn(),
    endEdit: vi.fn(),
  } as unknown as SelectionApi;
  let api: ReturnType<typeof useTransformGesture> | undefined;
  function Host(): ReactElement {
    api = useTransformGesture({
      doc,
      camera: { x: 0, y: 0, zoom: 1 },
      selection,
      snapshot: snap,
      canEdit: opts.canEdit ?? true,
      onGestureStart: startSpy,
      onGestureEnd: endSpy,
    });
    return (
      <div>
        {snap.map((o) => (
          <div key={o.id} data-obj={o.id} onPointerDown={(e) => api?.onObjectPointerDown(e, o.id)} />
        ))}
        {(['n', 'e', 'se', 'w'] as const).map((handleName) => (
          <div
            key={handleName}
            data-handle={handleName}
            onPointerDown={(e) => api?.onHandlePointerDown(e, handleName)}
          />
        ))}
      </div>
    );
  }
  const r = render(<Host />);
  return { ...r, startSpy, endSpy, selection };
}

const pos = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id)!;

describe('sel.transform', () => {
  it('TC-23: dragging unselected b while {a} selected → {b}, only b moves; threshold boundary', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const snap = snapshot(doc);
    const g = renderGesture(doc, snap, { initialIds: [a] });

    const bEl = g.container.querySelector(`[data-obj="${b}"]`) as HTMLElement;
    // Boundary: DRAG_THRESHOLD_PX - 1 is a click (no write).
    clickBoundary(g, bEl, 400, 100, 2);
    expect(pos(doc, a).x).toBe(0);
    expect(pos(doc, b).x).toBe(400); // unchanged
    expect([...g.selection.ids].sort()).toEqual([b]); // selection replaced

    // Exactly DRAG_THRESHOLD_PX starts the gesture and moves only b.
    dragOn(bEl, 400, 100, 400 + DRAG_THRESHOLD_PX, 100);
    expect(pos(doc, a).x).toBe(0); // a untouched
    expect(pos(doc, b).x).toBe(400 + DRAG_THRESHOLD_PX);
  });

  it('TC-24: testbox edge handle changes width only; Shift keeps ratio', () => {
    // (a) East edge, no Shift: width follows the drag, height is independent
    // (testbox is not aspect-locked).
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createTestbox(doc, { x: 0, y: 0, width: 100, height: 50 });
      const g = renderGesture(doc, snapshot(doc), { initialIds: [id] });
      const eEl = g.container.querySelector('[data-handle="e"]') as HTMLElement;
      dragOn(eEl, 100, 25, 150, 25); // +50 in x
      expect(pos(doc, id).width).toBe(150);
      expect(pos(doc, id).height).toBe(50);
      cleanup();
    }
    // (b) East edge, Shift: the box keeps its 2:1 ratio (height follows).
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createTestbox(doc, { x: 0, y: 0, width: 100, height: 50 });
      const g = renderGesture(doc, snapshot(doc), { initialIds: [id] });
      const eEl = g.container.querySelector('[data-handle="e"]') as HTMLElement;
      fireEvent.pointerDown(eEl, { clientX: 100, clientY: 25, pointerId: 1, shiftKey: true });
      fireEvent.pointerMove(window, { clientX: 150, clientY: 25, pointerId: 1, shiftKey: true });
      fireEvent.pointerUp(window, { clientX: 150, clientY: 25, pointerId: 1 });
      expect(pos(doc, id).width).toBe(150);
      expect(pos(doc, id).height).toBe(75); // 150 / 2 (ratio kept)
      cleanup();
    }
  });

  it('TC-24 (labels): handles carry "Resize <position>" aria-labels', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc);
    render(
      <SelectionOverlay
        ids={new Set([id])}
        snapshot={snap}
        camera={{ x: 0, y: 0, zoom: 1 }}
        onHandlePointerDown={() => {}}
      />,
    );
    const labels = [...screen.getAllByRole('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(
      expect.arrayContaining([
        'Resize top',
        'Resize top-right',
        'Resize right',
        'Resize bottom-right',
        'Resize bottom',
        'Resize bottom-left',
        'Resize left',
        'Resize top-left',
      ]),
    );
  });

  it('TC-25: canEdit false → no writes (negative)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc);
    const g = renderGesture(doc, snap, { initialIds: [id], canEdit: false });
    const el = g.container.querySelector(`[data-obj="${id}"]`) as HTMLElement;
    dragOn(el, 0, 0, 60, 40);
    expect(pos(doc, id).x).toBe(0); // unchanged
    expect(pos(doc, id).y).toBe(0);
    expect(g.startSpy).not.toHaveBeenCalled();
  });

  it('TC-26: onGestureStart/End once per drag; pointercancel keeps last applied state', () => {
    // (a) A completed drag fires start and end exactly once each.
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const g = renderGesture(doc, snapshot(doc), { initialIds: [id] });
      const el = g.container.querySelector(`[data-obj="${id}"]`) as HTMLElement;
      dragOn(el, 0, 0, 40, 0);
      expect(g.startSpy).toHaveBeenCalledTimes(1);
      expect(g.endSpy).toHaveBeenCalledTimes(1);
      cleanup();
    }
    // (b) A cancelled drag still fires start/end once each and keeps the last
    // applied state (no rollback).
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const g = renderGesture(doc, snapshot(doc), { initialIds: [id] });
      const el = g.container.querySelector(`[data-obj="${id}"]`) as HTMLElement;
      fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 90, clientY: 0, pointerId: 1 });
      expect(pos(doc, id).x).toBe(90); // applied
      fireEvent.pointerCancel(window, { clientX: 90, clientY: 0, pointerId: 1 });
      expect(g.startSpy).toHaveBeenCalledTimes(1);
      expect(g.endSpy).toHaveBeenCalledTimes(1);
      expect(pos(doc, id).x).toBe(90); // last applied state kept
    }
  });
});

function clickBoundary(g: ReturnType<typeof renderGesture>, el: HTMLElement, x: number, y: number, dist: number): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: x + dist, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: x + dist, clientY: y, pointerId: 1 });
}
// ---------------------------------------------------------------------------
// sel.keyboard (useBoardKeys)
// ---------------------------------------------------------------------------
describe('sel.keyboard', () => {
  it('TC-27: Ctrl/Cmd+A selects all with preventDefault', () => {
    let a = '';
    let b = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
      b = createSticky(doc, { x: 400, y: 100 });
    });
    const prevented = !fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(prevented).toBe(true);
    expect(selCount()).toBe(2);
    expect(allObjectIds(snapshot(h.doc)).sort()).toEqual([a, b].sort());
  });

  it('TC-28: Ctrl/Cmd+A on an empty board → empty, no error (boundary)', () => {
    const prevented = !fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(prevented).toBe(true);
    expect(selCount()).toBe(0);
  });

  it('TC-29: ArrowRight nudges x by step; Shift+ArrowUp nudges y by large step; preventDefault', () => {
    let a = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
    });
    clickAt(noteEl(a), 200, 200);

    const p1 = !fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(p1).toBe(true);
    expect(pos(h.doc, a).x).toBe(100 + NUDGE_STEP_WORLD);
    expect(pos(h.doc, a).y).toBe(100);

    const p2 = !fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    expect(p2).toBe(true);
    expect(pos(h.doc, a).x).toBe(100 + NUDGE_STEP_WORLD);
    expect(pos(h.doc, a).y).toBe(100 - NUDGE_LARGE_STEP_WORLD);
  });

  it('TC-30: Backspace while editing → text edited, object kept (negative)', () => {
    let a = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
    });
    // Enter editing via double-click.
    const el = noteEl(a);
    fireEvent.pointerDown(el, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.doubleClick(el);
    const textarea = h.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Backspace while editing must NOT delete the object.
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(h.doc).length).toBe(1);
    expect(pos(h.doc, a)).toBeDefined();
  });

  it('TC-31: Delete with a selection → all removed, selection empty', () => {
    let a = '';
    let b = '';
    h.seed((doc) => {
      a = createSticky(doc, { x: 100, y: 100 });
      b = createSticky(doc, { x: 400, y: 100 });
    });
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 500, 200, true);
    expect(snapshot(h.doc).length).toBe(2);

    const prevented = !fireEvent.keyDown(window, { key: 'Delete' });
    expect(prevented).toBe(true);
    expect(snapshot(h.doc).length).toBe(0);
    expect(selCount()).toBe(0);
  });
});
