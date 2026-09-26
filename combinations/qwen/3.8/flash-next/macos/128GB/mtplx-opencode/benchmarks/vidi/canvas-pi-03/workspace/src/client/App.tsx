import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { Toolbar } from './board/Toolbar';
import { useCamera } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { createSticky, deleteObject, setStickyColor, snapshot } from '../shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../shared/config';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, worldToScreen, type Size } from './canvas/camera';

function initialSize(): Size {
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  };
}

function isTextInput(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable === true;
}

/** A ref that always holds the latest value (avoids stale closures). */
function useRefLike<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Top-level board. Owns the camera (story 1), the Y.Doc-backed note snapshot and
 * the local selection/editing state (story 2), and wires note creation, colour
 * and delete through to the board model.
 */
export function App() {
  const [size, setSize] = useState<Size>(initialSize);
  const api = useCamera(size);
  const { doc, notes } = useBoardDoc();
  const sel = useSelection();

  // Keep the latest values available to the stable window keydown handler
  // without re-subscribing on every change.
  const selRef = useRefLike(sel);
  const docRef = useRefLike(doc);
  const apiRef = useRefLike(api);
  const sizeRef = useRefLike(size);

  const handleResize = useCallback((next: Size) => {
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
  }, []);

  const createAndEdit = useCallback(
    (at: { x: number; y: number }) => {
      const id = createSticky(docRef.current, at);
      selRef.current.startEdit(id);
    },
    [docRef, selRef],
  );

  // Delete a note and clear its selection. Shared by the note toolbar's bin
  // button and the Delete/Backspace keyboard shortcut.
  const removeNote = useCallback(
    (id: string) => {
      deleteObject(docRef.current, id);
      selRef.current.select(null);
    },
    [docRef, selRef],
  );

  // Double-click on empty board: create a note centred on the clicked point.
  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => {
      const world = screenToWorld(api.getCamera(), point);
      createAndEdit(world);
    },
    [api, createAndEdit],
  );

  // Clicking empty board clears the selection.
  const handleEmptyClick = useCallback(() => {
    selRef.current.select(null);
  }, [selRef]);

  // Toolbar button: create at the centre of the visible board area.
  const handleCreateSticky = useCallback(() => {
    const cam = api.getCamera();
    const centre = screenToWorld(cam, { x: size.width / 2, y: size.height / 2 });
    createAndEdit(centre);
  }, [api, size.width, size.height, createAndEdit]);

  // Board-wide keyboard handling for the selected (not-editing) note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = selRef.current;
      // While a note is being edited, or focus is in a text field, the keys
      // belong to the text editor.
      if (state.editingId !== null || isTextInput(document.activeElement)) return;

      if (e.key === 'n' || e.key === 'N') {
        // "Sticky note" tool shortcut: create a note at the viewport centre.
        e.preventDefault();
        const cam = apiRef.current.getCamera();
        const centre = screenToWorld(cam, { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 });
        const newId = createSticky(docRef.current, centre);
        state.startEdit(newId);
        return;
      }

      const id = state.selectedId;
      if (id == null) return; // TC-36: nothing selected → nothing happens

      if (e.key === 'Escape') {
        e.preventDefault();
        state.select(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        state.startEdit(id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeNote(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selRef, docRef, removeNote, apiRef]);

  // Test-only board hook: seed notes and read interaction state through the
  // real App wiring. Excluded from production builds (MODE !== 'test').
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    const w = window as unknown as { __vidi6?: Record<string, unknown> };
    w.__vidi6 = {
      ...(w.__vidi6 ?? {}),
      doc: docRef.current,
      worldToScreen: (p: { x: number; y: number }) => worldToScreen(api.getCamera(), p),
      seedSticky: (x: number, y: number, color?: string) => createSticky(docRef.current, { x, y }, color as never),
      snapshot: () => snapshot(docRef.current),
      select: (id: string | null) => selRef.current.select(id),
      startEdit: (id: string) => selRef.current.startEdit(id),
      getState: () => ({ selectedId: selRef.current.selectedId, editingId: selRef.current.editingId }),
    };
  }, [docRef, selRef, api]);

  const cam = api.camera;

  // Screen-space toolbar for the selected note (hidden while editing). It is a
  // sibling of the viewport, so its clicks never reach the board.
  const selectedNote =
    sel.editingId == null ? notes.find((n) => n.id === sel.selectedId) : undefined;
  const toolbarPos = selectedNote
    ? worldToScreen(cam, {
        x: selectedNote.x + STICKY_SIZE_WORLD / 2,
        y: selectedNote.y,
      })
    : null;

  return (
    <>
      <BoardViewport
        api={api}
        onSize={handleResize}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.zoom}
            selected={sel.selectedId === note.id}
            editing={sel.editingId === note.id}
            onSelect={(id) => sel.select(id)}
            onStartEdit={(id) => sel.startEdit(id)}
            onEndEdit={sel.endEdit}
          />
        ))}
      </BoardViewport>

      <Toolbar onCreateSticky={handleCreateSticky} />

      {selectedNote && toolbarPos && (
        <div
          style={{
            position: 'fixed',
            left: toolbarPos.x,
            top: toolbarPos.y - 10,
            transform: 'translate(-50%, -100%)',
            zIndex: 20,
          }}
        >
          <NoteToolbar
            color={selectedNote.color as StickyColor}
            onColor={(c) => setStickyColor(doc, selectedNote.id, c)}
            onDelete={() => removeNote(selectedNote.id)}
          />
        </div>
      )}

      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </>
  );
}
export default App;
