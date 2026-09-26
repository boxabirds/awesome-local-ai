import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { Toolbar } from './board/Toolbar';
import { useCamera } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import type { ConnectBoardOptions } from './sync/connectBoard';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { createSticky, deleteObject, getStickyText, moveObject, setStickyColor, snapshot, LOCAL_ORIGIN } from '../shared/board-model';
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
 * the local selection/editing state (story 2), and — from story 3 — the sync
 * connection for the board it renders. Selection and editing stay local.
 */
export interface AppProps {
  /** Room to sync with; null renders a purely local board. */
  boardId?: string | null;
  /** Test seam: build a fake provider instead of a real WebsocketProvider. */
  providerFactory?: ConnectBoardOptions['providerFactory'];
}

export function App({ boardId = null, providerFactory }: AppProps = {}) {
  const [size, setSize] = useState<Size>(initialSize);
  const api = useCamera(size);
  const connectOptions = useMemo<ConnectBoardOptions>(() => ({ providerFactory }), [providerFactory]);
  const { doc, notes, connectionState } = useBoardDoc(boardId, connectOptions);
  const sel = useSelection();

  // Latest connection state for the test hook (rendered-state snapshot) and
  // for the edit gates below (a board that could not be loaded is read-only).
  const connRef = useRefLike(connectionState);
  const editable = canEdit(connectionState);
  const editableRef = useRefLike(editable);

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
      if (!editableRef.current) return; // load-failed board: creation is a no-op
      const id = createSticky(docRef.current, at);
      selRef.current.startEdit(id);
    },
    [docRef, selRef],
  );

  // Delete a note and clear its selection. Shared by the note toolbar's bin
  // button and the Delete/Backspace keyboard shortcut.
  const removeNote = useCallback(
    (id: string) => {
      if (!editableRef.current) return;
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

  // Remote deletes (and a local delete of a selected note) clear stale
  // selection/edit state: once the id is gone from the board, no outline and
  // no editor may linger.
  useEffect(() => {
    const ids = new Set(notes.map((n) => n.id));
    const state = selRef.current;
    if ((state.selectedId !== null && !ids.has(state.selectedId)) || (state.editingId !== null && !ids.has(state.editingId))) {
      state.select(null);
    }
  }, [notes, selRef]);

  // Board-wide keyboard handling for the selected (not-editing) note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = selRef.current;
      // While a note is being edited, or focus is in a text field, the keys
      // belong to the text editor.
      if (state.editingId !== null || isTextInput(document.activeElement)) return;

      if (!editableRef.current) return; // load-failed board: no editing at all
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
      boardId,
      doc: docRef.current,
      worldToScreen: (p: { x: number; y: number }) => worldToScreen(api.getCamera(), p),
      seedSticky: (x: number, y: number, color?: string) => createSticky(docRef.current, { x, y }, color as never),
      snapshot: () => snapshot(docRef.current),
      select: (id: string | null) => selRef.current.select(id),
      startEdit: (id: string) => selRef.current.startEdit(id),
      getState: () => ({
        selectedId: selRef.current.selectedId,
        editingId: selRef.current.editingId,
        connectionState: connRef.current,
      }),
      // Story-3 helpers: mutate the board the same way the UI does, and read
      // the live connection state.
      connectionState: () => connRef.current,
      deleteSticky: (id: string) => {
        deleteObject(docRef.current, id);
        selRef.current.select(null);
      },
      moveSticky: (id: string, x: number, y: number) => moveObject(docRef.current, id, x, y),
      colorSticky: (id: string, color: string) => setStickyColor(docRef.current, id, color as StickyColor),
      typeSticky: (id: string, text: string, at?: number) => {
        const ytext = getStickyText(docRef.current, id);
        if (!ytext) return false;
        docRef.current.transact(() => {
          const pos = at === undefined ? ytext.length : Math.min(Math.max(at, 0), ytext.length);
          ytext.insert(pos, text);
        }, LOCAL_ORIGIN);
        return true;
      },
      // Nightly latency plumbing: ops are stamped into a shared test-only map
      // so receivers can measure document propagation time.
      markOp: (opId: string, t: number) => docRef.current.getMap<unknown>('testclock').set(opId, t),
      hasOp: (opId: string) => docRef.current.getMap<unknown>('testclock').has(opId),
    };
  }, [docRef, selRef, api, boardId]);

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
      <ConnectionStatus state={connectionState} />
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
            editable={editable}
            onSelect={(id) => sel.select(id)}
            onStartEdit={(id) => sel.startEdit(id)}
            onEndEdit={sel.endEdit}
          />
        ))}
      </BoardViewport>

      <Toolbar onCreateSticky={handleCreateSticky} disabled={!editable} />

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
            disabled={!editable}
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
