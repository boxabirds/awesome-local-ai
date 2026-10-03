// The board: an infinite canvas of objects, live-connected to the room behind this
// board's link. Story 7 made the board *multi-select* — a selection of objects can
// be moved, resized, nudged and deleted together — so the board now composes three
// generic pieces over the object registry: the transform gesture (move + resize),
// the Shift+drag marquee, and the selection keyboard commands. Objects themselves
// stay passive: each renders itself and reports a pointer-down; the gesture decides
// what happens.
//
// Editing is locked only while the board could not be loaded (`load_failed`): there
// is no real board on screen in that state, so every mutation path is handed
// `canEdit = false` and does nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
  type Size,
} from '../canvas/camera';
import { useCamera, type WheelInput } from '../canvas/useCamera';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useMarquee, MarqueeRect } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { SelectionOverlay } from './SelectionOverlay';
import { useBoardUndoController, UndoControllerContext } from './useUndo';
import { SelectionBar } from './SelectionBar';
import { useTool } from './useTool';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { IS_TEST_MODE, publishConnectionState } from '../canvas/testHooks';
import { getHandles, getObjectType } from '../objects/registry';
import { author } from './author';
import {
  allObjectIds,
  createSticky,
  deleteObjects,
  setStickyColor,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { createText, setTextSize } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';

/** Viewport size measured from the live board element via a ResizeObserver. */
function useViewportSize(
  ref: React.RefObject<HTMLDivElement | null>,
): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export interface BoardProps {
  /** Which board to connect to — the id from the address bar. */
  boardId: string;
}

export function Board({ boardId }: BoardProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(surfaceRef);
  const cam = useCamera(viewport);
  const { camera } = cam;
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const { ids, editingId, clear, startEdit, endEdit } = selection;

  // Editing is locked only while the board could not be loaded (`load_failed`).
  const editAllowed = canEdit(connectionState);

  // This tab's personal undo/redo history (story 8). A stable facade whose manager
  // lives for the mount; undo reverses only LOCAL_ORIGIN work (undo.own) and never a
  // colleague's. Gesture and creation boundaries below make one gesture = one step.
  const undo = useBoardUndoController(doc);

  // Which tool this person is holding (story 9): Select, or Text (the next board
  // click writes a text object there). Per-client and never persisted, and a board
  // that stops being editable drops Text back to Select.
  const tool = useTool(editAllowed);

  // The generic transform gesture (group move + resize) and the marquee, both read
  // the live selection / snapshot through refs, so their handler identities are
  // stable and BoardViewport's effects never re-subscribe mid-gesture. A drag opens
  // and closes an undo boundary so the whole gesture is exactly one undo step.
  const snapshot = notes as readonly ObjectSnapshot[];
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot,
    canEdit: editAllowed,
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });
  const marquee = useMarquee({
    camera,
    snapshot,
    selection,
    canEdit: editAllowed,
  });
  // Render objects in a DOM order that never changes (stable by id) and express
  // stacking purely through CSS z-index (obj.z): reordering the DOM on bring-to-
  // front would relocate the node and drop the in-flight pointer (see TC-39).
  const ordered = useMemo(
    () => [...snapshot].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [snapshot],
  );

  // Do resize handles apply? Only when some selected object's type is resizable.
  const showHandles = useMemo(() => {
    for (const obj of snapshot) {
      if (ids.has(obj.id) && getObjectType(obj.type)?.resizable) return true;
    }
    return false;
  }, [snapshot, ids]);

  // Which handles that box offers: a selection made only of horizontal-only types
  // (one text object) offers just the two side handles; anything mixed offers all
  // eight, because the box belongs to the resizable objects as much as to the text.
  const horizontalOnly = useMemo(() => {
    let any = false;
    for (const obj of snapshot) {
      if (!ids.has(obj.id)) continue;
      any = true;
      if (getHandles(obj.type) !== 'horizontal') return false;
    }
    return any;
  }, [snapshot, ids]);

  // Let e2e assert the badge state itself, not just what is on screen.
  useEffect(() => publishConnectionState(connectionState), [connectionState]);

  // Expose the board document to component tests so they can simulate model-level
  // events (e.g. a note deleted by a remote user mid-drag). No-op in production.
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    (window as unknown as { __vidi6Board?: Y.Doc }).__vidi6Board = doc;
  }, [doc]);

  // Bind the hook's intents so BoardViewport's effects that depend on them do
  // not re-subscribe on every render (the handler identities are stable).
  const onWheelInput = useCallback((e: WheelInput) => cam.wheel(e), [cam.wheel]);
  const onBeginPan = useCallback((p: Point) => cam.beginPan(p), [cam.beginPan]);
  const onPanMove = useCallback((p: Point) => cam.panMove(p), [cam.panMove]);
  const onEndPan = useCallback(() => cam.endPan(), [cam.endPan]);
  const onZoomStep = useCallback((d: 'in' | 'out') => cam.zoomStep(d), [cam.zoomStep]);
  const onReset = useCallback(() => cam.reset(), [cam.reset]);

  /** Create a note centred on a screen point and start editing it. */
  const createAtScreen = useCallback(
    (p: Point) => {
      if (!editAllowed) return;
      undo.boundary(); // each created note is its own undo step
      const world = screenToWorld(camera, p);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [camera, doc, startEdit, editAllowed, undo],
  );

  /** Toolbar button: create a note at the centre of the visible board area. */
  const createAtCentre = useCallback(() => {
    if (!editAllowed) return;
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtScreen(centre);
  }, [viewport.width, viewport.height, createAtScreen, editAllowed]);

  // The board keyboard: Enter edits, Delete deletes, arrows nudge, Ctrl+A selects all
  // — plus story 9's tool keys (V / T / Escape) and N for a sticky note.
  useBoardKeys({
    doc,
    selection,
    snapshot,
    canEdit: editAllowed,
    undo,
    tool,
    onCreateSticky: createAtCentre,
  });

  /**
   * The Text tool: a board click places a text object whose TOP-LEFT is the click
   * (text.create), then the tool returns to Select and the new object is selected and
   * being edited, ready for typing. One created object is one undo step.
   */
  const createTextAt = useCallback(
    (p: Point) => {
      if (!editAllowed) return;
      undo.boundary();
      const id = createText(doc, screenToWorld(camera, p), author(doc));
      tool.setTool('select');
      if (id) startEdit(id);
    },
    [camera, doc, startEdit, editAllowed, undo, tool],
  );

  /** The size toolbar picked a new preset: one undo step; the object re-measures its box. */
  const onTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!editAllowed) return;
      undo.boundary();
      setTextSize(doc, id, size);
    },
    [doc, editAllowed, undo],
  );

  const onColor = useCallback(
    (id: string, color: string) => {
      if (!editAllowed) return;
      undo.boundary(); // a colour change is its own step
      setStickyColor(doc, id, color);
    },
    [doc, editAllowed, undo],
  );

  const onDeleteObject = useCallback(
    (id: string) => {
      if (!editAllowed) return;
      undo.boundary();
      deleteObjects(doc, [id]); // selection prunes the gone id automatically
    },
    [doc, editAllowed, undo],
  );

  // The selection bar / keyboard delete the whole selection at once.
  const onDeleteSelection = useCallback(() => {
    if (!editAllowed) return;
    undo.boundary();
    deleteObjects(doc, allObjectIds(snapshot).filter((id) => ids.has(id)));
    clear();
  }, [doc, snapshot, ids, clear, editAllowed, undo]);

  // The object's own text editor ending: keep it selected, or deselect entirely.
  const onEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      if (next === 'selected') endEdit();
      else clear();
    },
    [endEdit, clear],
  );

  return (
    <UndoControllerContext.Provider value={undo}>
    <div className="vidi6-app">
      <BoardViewport
        ref={surfaceRef}
        camera={camera}
        onWheelInput={onWheelInput}
        onBeginPan={onBeginPan}
        onPanMove={onPanMove}
        onEndPan={onEndPan}
        onZoomStep={onZoomStep}
        onReset={onReset}
        onCreateStickyAt={createAtScreen}
        onEmptyClick={clear}
        onMarqueeStart={marquee.start}
        tool={tool.tool}
        onCreateTextAt={createTextAt}
      >
        {ordered.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null; // never render an unknown type
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={ids.has(obj.id)}
              sole={ids.size === 1 && ids.has(obj.id)}
              editing={obj.id === editingId}
              canEdit={editAllowed}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={startEdit}
              onEndEdit={onEndEdit}
              onColor={onColor}
              onDelete={onDeleteObject}
            />
          );
        })}
      </BoardViewport>

      {/* Screen-space selection affordances, drawn over the board. */}
      <SelectionOverlay
        camera={camera}
        snapshot={snapshot}
        ids={ids}
        showHandles={showHandles}
        horizontalOnly={horizontalOnly}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {marquee.rect ? <MarqueeRect rect={marquee.rect} camera={camera} /> : null}
      <SelectionBar
        camera={camera}
        snapshot={snapshot}
        ids={ids}
        onDelete={onDeleteSelection}
        onTextSize={onTextSize}
      />

      <Toolbar
        onCreateSticky={createAtCentre}
        tool={tool.tool}
        onSelectTool={tool.setTool}
        disabled={!editAllowed}
      />
      <ConnectionStatus state={connectionState} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
    </UndoControllerContext.Provider>
  );
}
