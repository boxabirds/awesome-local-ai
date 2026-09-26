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
import { createSticky, deleteObject, deleteObjects, getStickyText, moveObject, moveObjects, objectBounds, objectsInRect, resizeObjects, setStickyColor, snapshot, LOCAL_ORIGIN } from '../shared/board-model';
import { SelectionBar, selectionScreenBounds } from '../canvas/SelectionBar';
import { SelectionBox, type SelectionTransform } from '../canvas/SelectionBox';
import { clampScale, scaleWithin, unionRect, type Rect } from '../shared/geometry';
import { anyAspectLocked, anyResizable } from '../shared/object-types';
import { TransformGesture } from './board/transform-gesture';
import { STICKY_SIZE_WORLD, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD, STICKY_MIN_SIZE_WORLD, type StickyColor } from '../shared/config';
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
  const { doc, notes, undo, connectionState } = useBoardDoc(boardId, connectOptions);
  const sel = useSelection();

  // Latest connection state for the test hook (rendered-state snapshot) and
  // for the edit gates below (a board that could not be loaded is read-only).
  const connRef = useRefLike(connectionState);
  const editable = canEdit(connectionState);
  const editableRef = useRefLike(editable);
  // Undo goes through the store's UndoManager (local-origin edits only).
  const undoRef = useRefLike(undo);

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
  // no editor may linger. A multi-selection is PRUNED, not dropped: a peer who
  // deletes one of four selected notes leaves the other three selected (TC-35).
  useEffect(() => {
    const ids = new Set(notes.map((n) => n.id));
    const state = selRef.current;
    const kept = state.ids.filter((id) => ids.has(id));
    if (kept.length !== state.ids.length) {
      if (kept.length === 0) state.clear();
      else state.setSelection(kept);
      return;
    }
    if (state.editingId !== null && !ids.has(state.editingId)) state.select(null);
  }, [notes, selRef]);

  // Board-wide keyboard handling for the selection (when not editing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = selRef.current;
      // While a note is being edited, or focus is in a text field, the keys
      // belong to the text editor.
      if (state.editingId !== null || isTextInput(document.activeElement)) return;

      if (!editableRef.current) return; // load-failed board: no editing at all
      const doc = docRef.current;

      // App-level Undo: one Ctrl/Cmd+Z reverts the last group edit (one
      // transaction) across every selected object.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (undoRef.current()) state.clear();
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        // "Sticky note" tool shortcut: create a note at the viewport centre.
        e.preventDefault();
        const cam = apiRef.current.getCamera();
        const centre = screenToWorld(cam, { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 });
        const newId = createSticky(doc, centre);
        state.startEdit(newId);
        return;
      }

      // Arrow nudge moves the WHOLE selection by the same step. Shift = 10x.
      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (state.ids.length === 0) return;
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (dx !== 0 || dy !== 0) moveObjects(doc, state.ids, dx, dy);
        return;
      }

      if (state.ids.length === 0) return; // TC-36: nothing selected → nothing happens
      const primary = state.selectedId;

      if (e.key === 'Escape') {
        e.preventDefault();
        state.select(null);
      } else if (e.key === 'a' || e.key === 'A') {
        // Ctrl/Cmd+A selects every object on the board (contract `selection.select_all`).
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const all = snapshot(doc).map((o) => o.id);
        if (all.length > 0) state.setSelection(all);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (primary !== null) state.startEdit(primary);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        // Delete the whole group in one undo step, then clear the selection.
        deleteObjects(doc, state.ids);
        state.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selRef, docRef, apiRef]);

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
      // Story-7 seam: read the whole selection set, not just the primary id.
      selection: () => [...selRef.current.ids],
      selectAll: () => {
        const all = snapshot(docRef.current).map((o) => o.id);
        if (all.length > 0) selRef.current.setSelection(all);
      },
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

  // --- Group transform (story 7, contract `sel.transform`) -------------------
  // One gesture for the whole board: press any selected note and the whole
  // selection moves with it. Zoom and the edit gate are read fresh on every
  // event, so the gesture never holds a stale camera or a stale connection.
  const gesture = useMemo(
    () =>
      new TransformGesture({
        doc,
        zoom: () => apiRef.current.getCamera().zoom,
        canEdit: () => editableRef.current,
      }),
    // apiRef / editableRef are stable refs; only the document is a real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  // Escape cancels an armed gesture (contract `sel.transform`).
  useEffect(() => {
    const cancel = () => gesture.reset();
    window.addEventListener('pointercancel', cancel);
    return () => window.removeEventListener('pointercancel', cancel);
  }, [gesture]);

  const selectedSet = useMemo(() => new Set(sel.ids), [sel.ids]);

  // --- Selection frame, HUD and marquee -------------------------------------
  const [boxTransform, setBoxTransform] = useState<SelectionTransform | null>(null);

  // The selected objects, in the shape the geometry layer needs: a rect plus
  // the kind's declared limits. Unknown ids are skipped: a member the board no
  // longer has no geometry to transform.
  const members = useMemo(() => {
    if (sel.ids.length === 0) return [];
    const out: { id: string; rect: Rect }[] = [];
    for (const id of sel.ids) {
      const rect = objectBounds(doc, id);
      if (rect === null) continue;
      out.push({ id, rect });
    }
    return out;
  }, [sel.ids, notes, doc]);

  // Members are immutable while a box drag runs: the transform is always
  // measured from the box the gesture started with.
  const membersRef = useRefLike(members);
  const boxWorld = useMemo(() => {
    const current = boxTransform;
    if (current !== null) return current.to;
    return members.length === 0 ? null : members.map((m) => m.rect).reduce<Rect | null>((acc, r) => unionRect(acc, r), null);
  }, [members, boxTransform]);

  const boxBounds = useMemo(
    () => selectionScreenBounds(boxTransform !== null ? [boxTransform.to] : members.map((m) => m.rect), cam),
    [members, boxTransform, cam],
  );

  const resizable = members.length > 0 && anyResizable(['sticky']);

  const applyBoxTransform = useCallback(
    (t: SelectionTransform) => {
      if (!editableRef.current) return;
      setBoxTransform(t);
      const items = membersRef.current;
      if (items.length === 0) return;
      // One clamp for the whole group: the tightest member limit wins, so a
      // cluster shrinks and grows as one (contract `sel.resize`).
      const limits = items.map((m) => ({ rect: m.rect, minSize: STICKY_MIN_SIZE_WORLD, maxSize: Infinity }));
      let to = t.to;
      if (anyAspectLocked(['sticky'])) {
        // Sticky notes stay square: the box is forced back to a square.
        const side = Math.max(to.width, to.height);
        to = { x: to.x, y: to.y, width: side, height: side };
      }
      const requested = Math.max(to.width / Math.max(t.from.width, 1e-6), to.height / Math.max(t.from.height, 1e-6));
      const scale = clampScale(requested, limits);
      if (Math.abs(scale - requested) > 1e-9) {
        const cx = t.from.x + t.from.width / 2;
        const cy = t.from.y + t.from.height / 2;
        const w = t.from.width * scale;
        const h = t.from.height * scale;
        to = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
      }
      const next = new Map<string, Rect>();
      for (const m of items) next.set(m.id, scaleWithin(m.rect, t.from, to));
      resizeObjects(docRef.current, next);
    },
    [docRef, membersRef],
  );

  const endBoxTransform = useCallback(() => setBoxTransform(null), []);

  // A committed Shift+drag: everything the rectangle touched is selected, in
  // one transaction, on release. Hit-testing goes through the registry so a
  // shape-only kind would use its own hit rule (contract `sel.marquee`).
  const handleMarqueeCommit = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, additive: boolean) => {
      const world = screenToWorld(apiRef.current.getCamera(), { x: rect.x, y: rect.y });
      const far = screenToWorld(apiRef.current.getCamera(), { x: rect.x + rect.width, y: rect.y + rect.height });
      const box: Rect = {
        x: Math.min(world.x, far.x),
        y: Math.min(world.y, far.y),
        width: Math.abs(far.x - world.x),
        height: Math.abs(far.y - world.y),
      };
      const hits = objectsInRect(docRef.current, box);
      if (hits.length === 0) return;
      selRef.current.setSelection(hits, additive);
    },
    [apiRef, docRef, selRef],
  );

  const removeSelection = useCallback(() => {
    if (!editableRef.current) return;
    deleteObjects(docRef.current, selRef.current.ids);
    selRef.current.select(null);
  }, [docRef, selRef]);

  // Screen-space toolbar for the selected note (hidden while editing). It is a
  // sibling of the viewport, so its clicks never reach the board.
  const selectedNote =
    sel.editingId == null && sel.ids.length === 1
      ? notes.find((n) => n.id === sel.selectedId)
      : undefined;
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
        onMarqueeCommit={handleMarqueeCommit}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.zoom}
            selected={selectedSet.has(note.id)}
            groupIds={sel.ids}
            gesture={gesture}
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

      <SelectionBox
        bounds={boxBounds}
        world={boxWorld}
        camera={cam}
        mode={sel.ids.length >= 2 ? 'frame' : 'none'}
        resizable={resizable}
        onTransform={applyBoxTransform}
        onTransformEnd={endBoxTransform}
      />
      <SelectionBar count={sel.ids.length} bounds={boxBounds} resizable={resizable} onDelete={removeSelection} />
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
