// Component tests for toolbars (sticky.toolbar).
// TC-27 to TC-29.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardViewport, CameraContext } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  createSticky,
  deleteObject,
  initDoc,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { useSelection } from '../../src/client/board/useSelection';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { Toolbar } from '../../src/client/board/Toolbar';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

// Fake rAF
let rafId = 0;
const rafCallbacks = new Map<number, FrameRequestCallback>;
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafId++;
  rafCallbacks.set(rafId, cb);
  return rafId;
});
vi.stubGlobal('cancelAnimationFrame', (id: number) => {
  rafCallbacks.delete(id);
});

function flushRAF() {
  act(() => {
    const now = performance.now();
    const cbs = Array.from(rafCallbacks.entries());
    rafCallbacks.clear();
    cbs.forEach(([_, cb]) => cb(now));
  });
}

afterEach(() => {
  cleanup();
  rafCallbacks.clear();
});

function useDocSnapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const [snap, setSnap] = useState(() => snapshot(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const handler = () => setSnap(snapshot(doc));
    objects.observeDeep(handler);
    return () => objects.unobserveDeep(handler);
  }, [doc]);
  return snap;
}

function Harness({ doc }: { doc: Y.Doc }) {
  const api = useCamera({ width: 1280, height: 800 });
  const selection = useSelection();
  const objects = useDocSnapshot(doc);

  const handleCreateSticky = () => {
    const centre = { x: 1280 / 2, y: 800 / 2 };
    const world = screenToWorld(api.camera, centre);
    const id = createSticky(doc, world);
    if (id) selection.startEdit(id);
  };

  return (
    <CameraContext.Provider value={api}>
      <div>
        <BoardViewport
          onDblClickEmpty={(pt) => {
            const id = createSticky(doc, pt);
            if (id) selection.startEdit(id);
          }}
          onClickEmpty={() => selection.select(null)}
        >
          {objects.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selection.select}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={handleCreateSticky} />
        <div data-testid="selected" data-value={selection.selectedId ?? ''} />
        <div data-testid="editing" data-value={selection.editingId ?? ''} />
        <div data-testid="note-count" data-value={String(objects.length)} />
      </div>
    </CameraContext.Provider>
  );
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('sticky.toolbar (component)', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  test('TC-27 clicking Pink swatch changes colour, keeps selection', () => {
    const doc = makeDoc();
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<Harness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select the note
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });

    // Click the Pink swatch
    const pinkSwatch = screen.getByTestId('swatch-pink');
    act(() => {
      fireEvent.click(pinkSwatch);
    });

    // Model colour should be pink
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(noteId) as Y.Map<unknown>;
    expect(obj.get('color')).toBe('pink');
    // Selection kept
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
  });

  // TC-28: Sticky note button → one note centred on viewport centre, Editing
  test('TC-28 clicking Sticky note button creates note at viewport centre, editing', () => {
    const doc = makeDoc();

    render(<Harness doc={doc} />);

    // Click the Sticky note button
    const btn = screen.getByTestId('sticky-note-btn');
    act(() => {
      fireEvent.click(btn);
    });

    // One note should exist
    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('1');
    // Should be editing
    const editingId = screen.getByTestId('editing').getAttribute('data-value');
    expect(editingId).toBeTruthy();
    expect(editingId).not.toBe('');

    // Note should be centred on viewport centre (640, 400)
    // At 100% zoom with default camera (centred on origin), viewport centre = world (0, 0)
    // So note top-left should be at (0 - 100, 0 - 100) = (-100, -100)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const noteObj = Array.from(objects.values())[0] as Y.Map<unknown>;
    expect(noteObj.get('x')).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 0);
    expect(noteObj.get('y')).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 0);
  });

  // TC-29: bin button → note removed, selection cleared
  test('TC-29 clicking bin button deletes note, clears selection', () => {
    const doc = makeDoc();
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<Harness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select the note
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);

    // Click the delete (bin) button
    const deleteBtn = screen.getByTestId('delete-note-btn');
    act(() => {
      fireEvent.click(deleteBtn);
    });

    // Note should be removed
    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
    // Selection cleared
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
  });
});
