import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, type Camera, type Point } from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { StickyNote } from './objects/StickyNote';
import { registerSticky } from './objects/registry';
import {
  createSticky,
  deleteObjects,
  snapshot,
  type ObjectSnapshot,
} from '../shared/board-model';
import type { Handle } from '../shared/geometry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** Whether the board may be edited: not while its saved state cannot be loaded (never over an empty stand-in). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/** Routes `/` to the home page, `/b/:boardId` to that board (or Board not found), anything else to not found. */
export function Root() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}

// Register sticky type once at module level.
let stickyRegistered = false;
function ensureStickyRegistered() {
  if (!stickyRegistered) {
    registerSticky(StickyNote as any);
    stickyRegistered = true;
  }
}

/**
 * One board. With `boardId` it is live-synced with everyone else on that board.
 * `doc` lets tests supply their own document; the app creates one.
 */
export function App(props: { boardId?: string; doc?: Y.Doc } = {}) {
  ensureStickyRegistered();
  const { doc, notes, connection: rawConnection } = useBoardDoc(props.boardId, props.doc);
  // Test-only override for connection state (allows TC-25: canEdit=false).
  const [connectionOverride, setConnectionOverride] = useState<ConnectionState | null>(null);
  const connection = connectionOverride ?? rawConnection;
  const editable = canEdit(connection);

  // Convert StickySnapshot[] to ObjectSnapshot[] for generic operations.
  const objectSnapshots: readonly ObjectSnapshot[] = useMemo(
    () => notes.map((n) => ({
      id: n.id, type: n.type, x: n.x, y: n.y, z: n.z,
      width: n.width, height: n.height,
    })),
    [notes],
  );

  const selection = useSelection(objectSnapshots);
  const { click: selectClick, toggle: selectToggle, clear: selectClear, startEdit, endEdit, setMany } = selection;

  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, zoom: 1 });

  // Transform gesture
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objectSnapshots,
    canEdit: editable,
  });

  // Keyboard commands
  useBoardKeys({ doc, selection, snapshot: objectSnapshots, canEdit: editable });

  // Marquee
  const marquee = useMarquee(camera, objectSnapshots, (ids) => setMany(ids, true));

  // Enter edits the selected note. Keep old behavior for single selected sticky.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId !== null) return;
      if (selection.ids.size !== 1) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      if (e.key === 'Enter') {
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        e.preventDefault();
        const id = [...selection.ids][0];
        startEdit(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection.ids, selection.editingId, startEdit]);

  // A selected or edited note that no longer exists (deleted) is simply no longer selected.
  const exists = (id: string | null) => id !== null && notes.some((n) => n.id === id);
  const effectiveEditingId = editable && exists(selection.editingId) ? selection.editingId : null;

  useEffect(() => {
    if (!editable && selection.editingId !== null) endEdit();
  }, [editable, selection.editingId, endEdit]);

  const endEditWrapped = useCallback((next: 'selected' | 'unselected') => {
    if (next === 'unselected') {
      // Also remove from selection.
      if (selection.editingId !== null) {
        const id = selection.editingId;
        endEdit();
        // If it was the only one selected, clear; otherwise just leave without it (toggle).
        if (selection.ids.size === 1 && selection.ids.has(id)) selectClear();
      }
    } else {
      endEdit();
    }
  }, [selection.editingId, selection.ids, endEdit, selectClear]);

  const state = useRef({ editingId: effectiveEditingId, editable });
  state.current = { editingId: effectiveEditingId, editable };
  const createAt = useCallback(
    (world: Point) => {
      if (!state.current.editable) return;
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // Notes are drawn in a stable DOM order (by id) and stacked with z-index from their (z, id) rank.
  const stacked = useMemo(() => {
    const rank = new Map(notes.map((n, i) => [n.id, i + 1]));
    const byId = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return byId.map((note) => ({ note, stackIndex: rank.get(note.id)! }));
  }, [notes]);

  // Selection bar delete handler
  const onDeleteSelection = useCallback(() => {
    deleteObjects(doc, [...selection.ids]);
    selectClear();
  }, [doc, selection.ids, selectClear]);

  // Count announcement for accessibility
  const prevCount = useRef(0);
  useEffect(() => {
    if (selection.ids.size !== prevCount.current) {
      prevCount.current = selection.ids.size;
    }
  }, [selection.ids.size]);

  // Handle empty-space click (clears selection)
  const onEmptyClick = useCallback(() => {
    selectClear();
  }, [selectClear]);

  // Handle Shift+drag for marquee
  const onShiftDragStart = useCallback((screen: Point) => {
    marquee.begin(screen);
  }, [marquee]);

  const onShiftDragMove = useCallback((screen: Point) => {
    marquee.move(screen);
  }, [marquee]);

  const onShiftDragEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const onShiftDragCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  // Keep camera in sync for overlays
  const onCameraChange = useCallback((cam: Camera) => {
    setCameraState(cam);
  }, []);

  // Handle handle pointer events
  const onHandlePointerDown = useCallback((e: PointerEvent, h: Handle) => {
    gesture.onHandlePointerDown(e, h);
  }, [gesture]);

  const onHandlePointerMove = useCallback((e: PointerEvent) => {
    gesture.onHandlePointerMove(e);
  }, [gesture]);

  const onHandlePointerUp = useCallback((e: PointerEvent) => {
    gesture.onHandlePointerUp(e);
  }, [gesture]);

  const onHandlePointerCancel = useCallback((e: PointerEvent) => {
    gesture.onHandlePointerCancel(e);
  }, [gesture]);

  useEffect(() => installTestHooks({ notes: () => snapshot(doc) }), [doc]);
  useEffect(() => installTestHooks({ selection: () => [...selection.ids] }), [selection.ids]);
  useEffect(() => installTestHooks({
    connectionState: connection,
    setConnectionState: (s: ConnectionState) => setConnectionOverride(s),
  }), [connection]);

  return (
    <BoardViewport
      onDoubleClickEmpty={createAt}
      onEmptyClick={onEmptyClick}
      onShiftDragStart={onShiftDragStart}
      onShiftDragMove={onShiftDragMove}
      onShiftDragEnd={onShiftDragEnd}
      onShiftDragCancel={onShiftDragCancel}
      onCameraChange={onCameraChange}
      overlay={({ camera: cam, size }) => (
        <>
          <Toolbar
            disabled={!editable}
            onCreateSticky={() => createAt(screenToWorld(cam, { x: size.width / 2, y: size.height / 2 }))}
          />
          <ConnectionStatus state={connection} />
          <MarqueeRect rect={marquee.rect} camera={cam} />
          <SelectionOverlay
            ids={selection.ids}
            snapshot={objectSnapshots}
            camera={cam}
            onHandlePointerDown={onHandlePointerDown}
            onHandlePointerMove={onHandlePointerMove}
            onHandlePointerUp={onHandlePointerUp}
            onHandlePointerCancel={onHandlePointerCancel}
          />
          {selection.ids.size >= 2 && (
            <SelectionBar
              ids={selection.ids}
              onDelete={onDeleteSelection}
            />
          )}
        </>
      )}
    >
      {({ camera: cam }) =>
        stacked.map(({ note, stackIndex }) => (
          <StickyNote
            key={note.id}
            note={note}
            stackIndex={stackIndex}
            doc={doc}
            zoom={cam.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === effectiveEditingId}
            editable={editable}
            showNoteToolbar={selection.ids.size === 1 && selection.ids.has(note.id)}
            onSelect={(id) => selectClick(id)}
            onToggleSelect={(id) => selectToggle(id)}
            onStartEdit={startEdit}
            onEndEdit={endEditWrapped}
            onPointerDownGesture={gesture.onObjectPointerDown}
            onPointerMoveGesture={gesture.onObjectPointerMove}
            onPointerUpGesture={gesture.onObjectPointerUp}
            onPointerCancelGesture={gesture.onObjectPointerCancel}
          />
        ))
      }
    </BoardViewport>
  );
}
