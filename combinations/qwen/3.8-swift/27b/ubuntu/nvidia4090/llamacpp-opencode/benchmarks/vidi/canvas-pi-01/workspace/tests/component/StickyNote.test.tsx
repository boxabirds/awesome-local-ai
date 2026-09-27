// sticky.interaction (story 2): TC-18 to TC-22, TC-25, TC-35 to TC-37.
//
// App-level tests cover the full wiring (note + viewport + toolbars + window
// keys); standalone StickyNote tests cover the drag state machine against a
// real Y.Doc, including deletion mid-drag (TC-37).

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useMemo, useEffect, useState } from 'react';
import {
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { getObjectType } from '../../src/client/objects/registry';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { Camera } from '../../src/client/canvas/camera';
import {
  click,
  dispatch,
  expectedTransform,
  flushRaf,
  installResizeObserverMock,
  keyOn,
  pointerEvent,
  renderApp,
  viewportEl,
  windowKey,
  worldTransform,
} from './helpers';

// Home camera for the 1280x800 fixture: origin at screen (640, 400).
const HOME = { x: -640, y: -400, zoom: 1 };
const NOTE_CENTRE = { x: 640, y: 400 };
const EMPTY_POINT = { x: 100, y: 100 };

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

function noteEls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'));
}

function firstNote(container: HTMLElement): HTMLElement {
  const el = noteEls(container)[0];
  if (el === undefined) throw new Error('no sticky note rendered');
  return el;
}

/** Click the toolbar button: creates a note at the viewport centre, editing. */
function createNoteViaButton(): void {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Sticky note"]');
  if (button === null) throw new Error('toolbar button not rendered');
  click(button);
}

function clickEmpty(container: HTMLElement): void {
  const vp = viewportEl(container);
  dispatch(vp, pointerEvent('pointerdown', EMPTY_POINT.x, EMPTY_POINT.y));
  dispatch(vp, pointerEvent('pointerup', EMPTY_POINT.x, EMPTY_POINT.y));
}

function clickNote(container: HTMLElement): void {
  const note = firstNote(container);
  dispatch(note, pointerEvent('pointerdown', NOTE_CENTRE.x, NOTE_CENTRE.y));
  dispatch(note, pointerEvent('pointerup', NOTE_CENTRE.x, NOTE_CENTRE.y));
}

function doubleClickNote(container: HTMLElement): void {
  const note = firstNote(container);
  dispatch(
    note,
    new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: NOTE_CENTRE.x, clientY: NOTE_CENTRE.y }),
  );
}

function editingTextarea(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"] textarea');
  if (el === null) throw new Error('no editor textarea rendered');
  return el;
}

function noteDoc(): Y.Doc {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook not installed');
  return hook.getDoc();
}

/** Escape ends editing; then the board is deselected. */
function exitEditingAndDeselect(container: HTMLElement): void {
  keyOn(editingTextarea(), 'Escape');
  clickEmpty(container);
}

describe('sticky.interaction — app level', () => {
  it('TC-18 press + release without movement selects: outline and note toolbar shown', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    exitEditingAndDeselect(container);
    expect(firstNote(container).hasAttribute('data-selected')).toBe(false);
    expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();

    clickNote(container);

    expect(firstNote(container).hasAttribute('data-selected')).toBe(true);
    expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();
  });

  it('TC-19 move 2px (< DRAG_THRESHOLD_PX) then release: selected, note not moved', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    exitEditingAndDeselect(container);
    clickNote(container);

    const note = firstNote(container);
    dispatch(note, pointerEvent('pointerdown', NOTE_CENTRE.x, NOTE_CENTRE.y));
    dispatch(note, pointerEvent('pointermove', NOTE_CENTRE.x + 2, NOTE_CENTRE.y));
    dispatch(note, pointerEvent('pointerup', NOTE_CENTRE.x + 2, NOTE_CENTRE.y));
    await flushRaf();

    const id = note.dataset.id as string;
    expect(snapshot(noteDoc()).find((n) => n.id === id)?.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-20 drag on a note never pans the board (camera unchanged)', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    exitEditingAndDeselect(container);
    clickNote(container);
    expect(worldTransform(container)).toBe(expectedTransform(HOME));

    const note = firstNote(container);
    dispatch(note, pointerEvent('pointerdown', NOTE_CENTRE.x, NOTE_CENTRE.y));
    dispatch(note, pointerEvent('pointermove', NOTE_CENTRE.x + 40, NOTE_CENTRE.y + 25));
    await flushRaf();
    dispatch(note, pointerEvent('pointerup', NOTE_CENTRE.x + 40, NOTE_CENTRE.y + 25));
    await flushRaf();

    expect(worldTransform(container)).toBe(expectedTransform(HOME));
    const id = note.dataset.id as string;
    const moved = snapshot(noteDoc()).find((n) => n.id === id);
    expect(moved?.x).toBe(-STICKY_SIZE_WORLD / 2 + 40);
    expect(moved?.y).toBe(-STICKY_SIZE_WORLD / 2 + 25);
  });

  it('TC-22 click empty board clears the selection and the toolbar', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    keyOn(editingTextarea(), 'Escape');
    clickNote(container);
    expect(firstNote(container).hasAttribute('data-selected')).toBe(true);
    expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();

    clickEmpty(container);

    expect(firstNote(container).hasAttribute('data-selected')).toBe(false);
    expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();
  });

  it('TC-25 Delete key removes the selected note', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    keyOn(editingTextarea(), 'Escape');
    clickNote(container);
    expect(noteEls(container)).toHaveLength(1);

    windowKey('Delete');

    expect(noteEls(container)).toHaveLength(0);
    expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();
  });

  it('TC-25b Backspace removes the selected note (separate run)', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    keyOn(editingTextarea(), 'Escape');
    clickNote(container);
    expect(noteEls(container)).toHaveLength(1);

    windowKey('Backspace');

    expect(noteEls(container)).toHaveLength(0);
  });

  it('TC-35 double-click on an existing note edits it and creates no new note', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    exitEditingAndDeselect(container);
    expect(noteEls(container)).toHaveLength(1);

    doubleClickNote(container);

    expect(noteEls(container)).toHaveLength(1);
    expect(editingTextarea()).not.toBeNull();
  });

  it('TC-36 Enter with nothing selected creates no note (negative)', async () => {
    await renderApp();
    windowKey('Enter');
    expect(noteEls(document.body)).toHaveLength(0);
  });

  it('TC-37b note deleted via model while editing: interaction ends, no crash, note not recreated', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    const note = firstNote(container);
    const id = note.dataset.id as string;
    expect(editingTextarea()).not.toBeNull();

    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('test hook not installed');
    let removed = false;
    act(() => {
      removed = hook.deleteNote(id);
    });
    expect(removed).toBe(true);

    expect(noteEls(container)).toHaveLength(0);
    expect(container.querySelector('[data-testid="sticky-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();
  });
});

// --- standalone StickyNote: drag state machine against a real Y.Doc ---
//
// The note renders inside a harness that wires the real useSelection +
// useTransformGesture (the story 7 shared gesture), so these tests exercise
// the same drag state machine as the app.

interface DragLog {
  /** draggingIds marker on every change: the id while dragging, null otherwise. */
  dragging: (string | null)[];
  starts: number;
  ends: number;
}

function makeDocWithNote(x = 0, y = 0): { doc: Y.Doc; note: ObjectSnapshot } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
  moveObjects(doc, new Map([[id, { x, y }]]));
  const note = snapshot(doc)[0];
  if (note === undefined) throw new Error('note not created');
  return { doc, note };
}

function StandaloneHarness({
  doc,
  note,
  zoom,
  log,
}: {
  doc: Y.Doc;
  note: ObjectSnapshot;
  zoom: number;
  log: DragLog;
}) {
  const [snap, setSnap] = useState<readonly ObjectSnapshot[]>([note]);
  const selection = useSelection(snap);
  const camera = useMemo<Camera>(() => ({ x: 0, y: 0, zoom }), [zoom]);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: snap,
    canEdit: true,
    onGestureStart: () => {
      log.starts += 1;
    },
    onGestureEnd: () => {
      log.ends += 1;
    },
  });
  useEffect(() => {
    log.dragging.push(gesture.draggingIds.size > 0 ? [...gesture.draggingIds][0] ?? null : null);
  }, [gesture.draggingIds, log]);
  // Track doc changes (e.g. a remote deletion) so the selection prunes.
  useEffect(() => {
    const handler = () => setSnap(snapshot(doc));
    doc.getMap('objects').observeDeep(handler);
    return () => doc.getMap('objects').unobserveDeep(handler);
  }, [doc]);

  const spec = getObjectType(note.type);
  if (spec === undefined) return null;
  const Component = spec.Component;
  return (
    <Component
      obj={note}
      doc={doc}
      zoom={zoom}
      selected={selection.ids.has(note.id)}
      editing={selection.editingId === note.id}
      dragging={gesture.draggingIds.has(note.id)}
      editable
      onObjectPointerDown={gesture.onObjectPointerDown}
      onFocusSelect={(id) => selection.click(id)}
      onStartEdit={selection.startEdit}
      onEndEdit={selection.endEdit}
    />
  );
}

function renderStandalone(
  doc: Y.Doc,
  note: ObjectSnapshot,
  zoom = 1,
  log: DragLog = { dragging: [], starts: 0, ends: 0 },
) {
  return render(<StandaloneHarness doc={doc} note={note} zoom={zoom} log={log} />);
}

function noteEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="sticky-note"]');
  if (el === null) throw new Error('note not rendered');
  return el;
}

describe('sticky.interaction — standalone note (shared gesture)', () => {
  it('TC-19b pointermove 2px below threshold: no drag starts, no movement, no gesture start', async () => {
    const { doc, note } = makeDocWithNote();
    const log: DragLog = { dragging: [], starts: 0, ends: 0 };
    const { container } = renderStandalone(doc, note, 1, log);
    const el = noteEl(container);

    dispatch(el, pointerEvent('pointerdown', 100, 100));
    dispatch(el, pointerEvent('pointermove', 102, 100));
    dispatch(el, pointerEvent('pointerup', 102, 100));
    await flushRaf();

    expect(snapshot(doc).find((n) => n.id === note.id)?.x).toBe(0);
    expect(snapshot(doc).find((n) => n.id === note.id)?.y).toBe(0);
    expect(log.starts).toBe(0);
    expect(log.ends).toBe(0);
    // The note was still selected by the click.
    expect(el.getAttribute('data-selected')).toBe('true');
  });

  it('TC-20b move 3px (= threshold) starts a drag: bringToFront + moveObjects at zoom 1', async () => {
    const { doc, note } = makeDocWithNote();
    // A second note above, so bringToFront has something to do.
    createSticky(doc, { x: 400, y: 400 });
    const log: DragLog = { dragging: [], starts: 0, ends: 0 };
    const { container } = renderStandalone(doc, note, 1, log);
    const el = noteEl(container);

    dispatch(el, pointerEvent('pointerdown', 100, 100));
    dispatch(el, pointerEvent('pointermove', 103, 100));
    await flushRaf();
    dispatch(el, pointerEvent('pointerup', 103, 100));
    await flushRaf();

    const moved = snapshot(doc).find((n) => n.id === note.id);
    expect(moved?.x).toBe(3);
    expect(moved?.y).toBe(0);
    // bringObjectsToFront ran on drag start: z went 1 → 3 (maxZ 2 + 1).
    expect(moved?.z).toBe(3);
    expect(log.starts).toBe(1);
    expect(log.ends).toBe(1);
    expect(log.dragging).toContain(note.id);
    expect(log.dragging[log.dragging.length - 1]).toBe(null);
  });

  it('TC-21 pointercancel keeps the last shown position and ends the gesture', async () => {
    const { doc, note } = makeDocWithNote();
    const log: DragLog = { dragging: [], starts: 0, ends: 0 };
    const { container } = renderStandalone(doc, note, 1, log);
    const el = noteEl(container);

    dispatch(el, pointerEvent('pointerdown', 100, 100));
    dispatch(el, pointerEvent('pointermove', 110, 100));
    await flushRaf(); // applied: x = 10
    dispatch(el, pointerEvent('pointermove', 120, 100)); // not flushed
    dispatch(el, pointerEvent('pointercancel', 120, 100));
    await flushRaf();

    expect(snapshot(doc).find((n) => n.id === note.id)?.x).toBe(10);
    expect(log.ends).toBe(1);
    expect(log.dragging[log.dragging.length - 1]).toBe(null);
  });

  it('TC-20c drag at zoom 2: screen delta is divided by zoom', async () => {
    const { doc, note } = makeDocWithNote();
    const log: DragLog = { dragging: [], starts: 0, ends: 0 };
    const { container } = renderStandalone(doc, note, 2, log);
    const el = noteEl(container);

    dispatch(el, pointerEvent('pointerdown', 100, 100));
    dispatch(el, pointerEvent('pointermove', 120, 110));
    await flushRaf();
    dispatch(el, pointerEvent('pointerup', 120, 110));
    await flushRaf();

    const moved = snapshot(doc).find((n) => n.id === note.id);
    expect(moved?.x).toBe(10);
    expect(moved?.y).toBe(5);
  });

  it('TC-37 note deleted via model while dragging: writes stop silently, no re-creation', async () => {
    const { doc, note } = makeDocWithNote();
    const log: DragLog = { dragging: [], starts: 0, ends: 0 };
    const { container } = renderStandalone(doc, note, 1, log);
    const el = noteEl(container);

    dispatch(el, pointerEvent('pointerdown', 100, 100));
    dispatch(el, pointerEvent('pointermove', 110, 100));
    await flushRaf();
    expect(deleteObjects(doc, [note.id])).toBe(1);
    dispatch(el, pointerEvent('pointermove', 130, 100));
    await flushRaf(); // no exception: moveObjects on the stale id is a no-op
    dispatch(el, pointerEvent('pointerup', 130, 100));
    await flushRaf();

    expect(doc.getMap('objects').size).toBe(0);
    expect(log.ends).toBe(1);
    expect(log.dragging[log.dragging.length - 1]).toBe(null);
    void container;
  });
});
