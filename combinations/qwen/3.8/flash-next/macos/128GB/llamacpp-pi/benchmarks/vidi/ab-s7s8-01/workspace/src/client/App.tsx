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
import { NoteToolbar } from './objects/NoteToolbar';
import { ObjectView, declareObjectTypes } from './objects/registry';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar, SelectionStatus } from './board/SelectionBar';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, Marquee } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { createUndo, type UndoController } from './board/undo';
import { UndoControllerContext, useUndo } from './board/useUndo';
import type { BackgroundPointerDown } from './canvas/BoardViewport';
import {
  allObjectIds,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  objectBounds,
  setStickyColor,
  snapshot,
  LOCAL_ORIGIN,
} from '../shared/board-model';
import { type StickyColor } from '../shared/config';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, worldToScreen, type Size } from './canvas/camera';

// The board object type registry is filled before the first render, so every object
// in a loaded document has a renderer (and an unknown type renders nothing).
declareObjectTypes();

function initialSize(): Size {
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  };
}

/** A ref that always holds the latest value (avoids stale closures). */
function useRefLike<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Origin for the test-only seed hooks. Fixtures are pre-existing board
 * content, not something the current user did, so they are written with a
 * non-local origin: the undo controller (trackedOrigins = {LOCAL_ORIGIN})
 * never captures them and they sync to peers like any remote change.
 */
const FIXTURE_SEED_ORIGIN = Symbol('vidi6.fixture-seed');

/**
 * Top-level board. Owns the camera (story 1), the Y.Doc-backed note snapshot and
 * the local selection/editing state (story 2), and — from story 3 — the sync
 * connection for the board it renders. Selection and editing stay local.
 *
 * Story 7 makes the selection a set, and adds the pieces that work on that set: one
 * generic gesture for move / resize / delete, a marquee that takes a selection by
 * dragging on the background, a bounding box with eight handles, and the keyboard
 * commands. Objects render through the registry, so none of that is note-specific.
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
  // The selection is local state, pruned against the document: an object someone
  // else deleted drops out of it while the rest stay selected.
  const sel = useSelection(notes);

  // Latest connection state for the test hook (rendered-state snapshot) and
  // for the edit gates below (a board that could not be loaded is read-only).
  const connRef = useRefLike(connectionState);
  const editable = canEdit(connectionState);
  const editableRef = useRefLike(editable);

  // --- story 8: undo / redo for THIS tab's own changes ------------------------
  // One controller per board session (PRD "per person per tab"). Created once
  // the doc exists and destroyed on teardown; nothing renders undo state in
  // the single frame before this effect runs, so a null controller only ever
  // means "disabled buttons". Remote updates carry the provider origin and
  // story 4's load applies carry the load origin — neither is ever captured.
  const [undoController, setUndoController] = useState<UndoController | null>(null);
  useEffect(() => {
    const controller = createUndo(doc);
    setUndoController(controller);
    return () => {
      controller.destroy();
      setUndoController(null);
    };
  }, [doc]);
  const undoControllerRef = useRefLike(undoController);
  /** Close the current capture window: the next local write is a NEW step. */
  const undoBoundary = useCallback(() => undoControllerRef.current?.boundary(), [undoControllerRef]);
  const undoApi = useUndo(undoController, editable);

  // Keep the latest values available to the stable window keydown handler
  // without re-subscribing on every change.
  const selRef = useRefLike(sel);
  const docRef = useRefLike(doc);
  const apiRef = useRefLike(api);
  const sizeRef = useRefLike(size);
  const notesRef = useRefLike(notes);
  const selectedIdsRef = useRefLike<ReadonlySet<string>>(sel.ids);

  const handleResize = useCallback((next: Size) => {
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
  }, []);

  const createAndEdit = useCallback(
    (at: { x: number; y: number }) => {
      if (!editableRef.current) return; // load-failed board: creation is a no-op
      // Boundaries on both sides: creation is one undo step whatever follows
      // it inside the capture window (story 2's "create then edit" flow).
      undoBoundary();
      const id = createSticky(docRef.current, at);
      undoBoundary();
      selRef.current.startEdit(id);
    },
    [docRef, selRef, undoBoundary],
  );

  // Delete a note and clear its selection. Shared by the note toolbar's bin
  // button and the Delete/Backspace keyboard shortcut.
  const removeNote = useCallback(
    (id: string) => {
      if (!editableRef.current) return;
      undoBoundary();
      deleteObject(docRef.current, id);
      undoBoundary(); // one toolbar deletion == one undo step
      selRef.current.select(null);
    },
    [docRef, selRef, undoBoundary],
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

  // Toolbar button and the "n" shortcut: create at the centre of the visible area.
  const createAtCentre = useCallback(() => {
    const cam = apiRef.current.getCamera();
    const centre = screenToWorld(cam, { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 });
    createAndEdit(centre);
  }, [apiRef, sizeRef, createAndEdit]);

  const handleCreateSticky = useCallback(() => createAtCentre(), [createAtCentre]);

  // --- story 7: the generic gesture, the marquee, the keyboard commands ---------

  const gesture = useTransformGesture({
    getCamera: () => apiRef.current.getCamera(),
    doc,
    getSnapshot: () => notesRef.current,
    getSelectedIds: () => selectedIdsRef.current,
    isEditable: () => editableRef.current,
    onSelectionChange: (ids) => selRef.current.setMany(ids, false),
    onObjectsDeleted: () => selRef.current.clear(),
    // Story 8: a whole drag (however many frames) is ONE undo step — the
    // boundaries close the capture window around the gesture. TC-14.
    onGestureStart: undoBoundary,
    onGestureEnd: undoBoundary,
  });

  const marquee = useMarquee({
    getCamera: () => apiRef.current.getCamera(),
    getSnapshot: () => notesRef.current,
    addToMany: (ids) => selRef.current.setMany(ids, true),
  });

  // Shift + drag on the background. BoardViewport has already checked that the press
  // landed on empty space, so there is nothing left to filter here.
  const handleBackgroundPointerDown = useCallback(
    (e: BackgroundPointerDown) => {
      marquee.begin(e);
    },
    [marquee],
  );

  // Select All, Escape, Delete / Backspace, Enter, undo / redo and the
  // arrow-key nudge.
  useBoardKeys({
    doc,
    getSnapshot: () => notesRef.current,
    getSelectedIds: () => selectedIdsRef.current,
    getEditingId: () => selRef.current.editingId,
    isEditable: () => editableRef.current,
    setMany: sel.setMany,
    startEdit: sel.startEdit,
    clear: sel.clear,
    deleteSelection: gesture.deleteSelection,
    marqueeActive: () => marquee.isActive(),
    createObject: createAtCentre,
    undo: undoApi,
    undoBoundary,
  });

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
      // Story 7: the whole selection (local, never synced), and Select All.
      selectedIds: () => [...selRef.current.ids],
      selectAll: () => selRef.current.setMany(allObjectIds(snapshot(docRef.current)), false),
      // Fixtures are seeded with a non-local origin so they behave like
      // content that was already on the board: the undo controller never
      // captures them (they still sync to peers normally).
      seedSticky: (x: number, y: number, color?: string) =>
        docRef.current.transact(
          () => createSticky(docRef.current, { x, y }, color as never),
          FIXTURE_SEED_ORIGIN,
        ) as string,
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
    sel.editingId == null && sel.selectedId !== null ? notes.find((n) => n.id === sel.selectedId) : undefined;
  const toolbarPos = selectedNote
    ? worldToScreen(cam, {
        x: objectBounds(selectedNote).x + objectBounds(selectedNote).width / 2,
        y: objectBounds(selectedNote).y,
      })
    : null;

  // The objects the selection bar and the bounding box are drawn for.
  const selectedObjects = notes.filter((n) => sel.ids.has(n.id));

  return (
    <UndoControllerContext.Provider value={undoController}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        api={api}
        onSize={handleResize}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onBackgroundPointerDown={handleBackgroundPointerDown}
      >
        {notes.map((note) => (
          <ObjectView
            key={note.id}
            obj={note}
            doc={doc}
            camera={cam}
            selected={sel.ids.has(note.id)}
            editing={sel.editingId === note.id}
            editable={editable}
            selectedIds={sel.ids}
            onSelect={sel.click}
            onToggle={sel.toggle}
            onObjectPointerDown={(e, id, override) => gesture.onObjectPointerDown(e, id, override)}
            onStartEdit={(id) => sel.startEdit(id)}
            onEndEdit={sel.endEdit}
          />
        ))}
        {/* The selection bounding box and the marquee live in the world layer, so
            they pan and zoom with the board; only their border width and the
            handle size are divided by the zoom to stay constant on screen. */}
        <SelectionOverlay
          objects={selectedObjects}
          camera={cam}
          editable={editable}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <Marquee rect={marquee.rect} zoom={cam.zoom} />
      </BoardViewport>

      <Toolbar onCreateSticky={handleCreateSticky} disabled={!editable} undo={undoApi} />

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
            onColor={(c) => {
              if (!editableRef.current) return;
              undoBoundary();
              setStickyColor(doc, selectedNote.id, c);
              undoBoundary(); // one colour click == one undo step (TC-15)
            }}
            onDelete={() => removeNote(selectedNote.id)}
          />
        </div>
      )}

      {/* A multi-selection gets the selection bar; a single sticky note keeps the
          story 2 note toolbar (TC-18: exactly one sticky note shows the toolbar). */}
      <SelectionBar
        objects={selectedObjects}
        camera={cam}
        editable={editable}
        onDelete={() => {
          undoBoundary();
          gesture.deleteSelection();
          undoBoundary(); // one bar deletion == one undo step
        }}
      />
      <SelectionStatus count={sel.count} />

      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </UndoControllerContext.Provider>
  );
}
export default App;
