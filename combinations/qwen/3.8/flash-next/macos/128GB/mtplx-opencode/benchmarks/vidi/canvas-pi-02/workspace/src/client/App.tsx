import { useCallback, useEffect, useRef } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, worldToScreen, zoomPercent } from './canvas/camera';
import type { Camera, Point } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraContext, useCamera, useViewportSize } from './canvas/useCamera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installBoardTestHooks, removeBoardTestHooks } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardSnapshot } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useUndo, useUndoController } from './board/useUndo';
import type { UndoController } from './board/undo';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar, TextSelectionBar } from './board/SelectionBar';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useTool } from './board/useTool';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import './objects/defaultTypes';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../shared/board-model';
import { createText, setTextSize, setTextWidthFixed } from '../shared/objects/text';
import { createCanvasMeasurer } from './objects/textLayout';
import { createTextBoxSync } from './objects/useTextBoxSync';
import { isValidBoardId, parseBoardPath } from '../shared/board-id';
import { STICKY_SIZE_WORLD, type TextSize } from '../shared/config';
import { unionRects } from '../shared/geometry';
import { useBoardSession, type BoardSession } from './sync/boardSession';
import { ConnectionStatus, useConnectionState } from './sync/ConnectionStatus';
import { PresenceIdentity, PresenceStack, RemoteCursors, RemoteSelections } from './presence/Presence';
import { toScreenPeople, usePresence } from './presence/usePresence';
import type { Person } from './presence/people';
import type { ProviderLike } from './sync/connectBoard';
import * as Y from 'yjs';

/** The prefix that marks a path as "someone is trying to open a board link". */
const BOARD_PATH_PREFIX = '/board/';

export function isBrokenBoardLink(path: string): boolean {
  if (!path.startsWith(BOARD_PATH_PREFIX)) return false;
  const last = path.split('/').filter((segment) => segment.length > 0).pop() ?? '';
  return !isValidBoardId(last);
}

export interface AppProps {
  location?: string;
  doc?: Y.Doc;
  providerFactory?: (url: string, room: string, doc: Y.Doc) => ProviderLike;
  origin?: string;
  /**
   * Whether this board accepts edits. True for a board that loaded, whether or
   * not it is online (a dropped socket is never a lockout); a harness can put
   * it to `false` to prove the transform and keyboard paths refuse to write.
   */
  canEdit?: boolean;
  /** Called once when a transform gesture (group move or resize) begins. */
  onGestureStart?(): void;
  /** Called once when that gesture ends, is cancelled, or loses its objects. */
  onGestureEnd?(): void;
  /**
   * The personal undo history, injected for tests. Without one the surface
   * builds its own per document (story 8).
   */
  undo?: UndoController;
}

function useSessionFor(props: AppProps): BoardSession {
  const path =
    props.location ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  return useBoardSession(parseBoardPath(path), {
    doc: props.doc,
    providerFactory: props.providerFactory,
    origin: props.origin,
  });
}

export function App(props: AppProps = {}) {
  const session = useSessionFor(props);
  const path =
    props.location ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  const broken = isBrokenBoardLink(path);
  return (
    <BoardSurface
      key={`${session.boardId}:${session.url ?? 'local'}`}
      session={session}
      broken={broken}
      canEdit={props.canEdit ?? true}
      onGestureStart={props.onGestureStart}
      onGestureEnd={props.onGestureEnd}
      undo={props.undo}
    />
  );
}

function BoardSurface({
  session,
  broken,
  canEdit,
  onGestureStart,
  onGestureEnd,
  undo,
}: {
  session: BoardSession;
  broken: boolean;
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
  undo?: UndoController;
}) {
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(boardAreaRef);
  const cameraApi = useCamera(viewport);
  const board = session.board;
  const objects = useBoardSnapshot(board);
  const selection = useSelection();
  const connectionState = useConnectionState(session.connection);

  // Story 8: one personal undo history per board document. The keyboard
  // hook, the gestures and the toolbar buttons all act through it.
  const undoController = useUndoController(board, undo);
  const undoState = useUndo(undoController, canEdit);

  // Story 9: tool mode.
  const { tool, setTool } = useTool(canEdit);

  const boardRef = useRef(board);
  boardRef.current = board;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const cameraRef = useRef<{ camera: Camera }>(cameraApi);
  cameraRef.current = cameraApi;

  // Story 9: text creation.
  const measurerRef = useRef(createCanvasMeasurer());

  const presence = usePresence(session, cameraRef);
  const presenceRef = useRef(presence);
  presenceRef.current = presence;

  const apiRef = useRef(cameraApi);
  useEffect(() => {
    apiRef.current = cameraApi;
  });

  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    installBoardTestHooks(
      () => apiRef.current,
      () => sessionRef.current,
    );
    return () => removeBoardTestHooks();
  }, []);

  // Pointer publishing.
  useEffect(() => {
    const area = boardAreaRef.current;
    if (area === null) return;
    const onPointerMove = (event: PointerEvent): void => {
      const rect = area.getBoundingClientRect();
      presenceRef.current.publish({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    area.addEventListener('pointermove', onPointerMove);
    const onPointerLeave = (): void => { presenceRef.current.hide(); };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') presenceRef.current.hide();
    };
    area.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      area.removeEventListener('pointermove', onPointerMove);
      area.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  /** Put a sticky at a world point and start typing straight away. */
  const createStickyAt = useCallback(
    (point: Point) => {
      const id = createSticky(boardRef.current.doc, point);
      if (!id) return;
      selection.startEdit(id);
    },
    [selection],
  );

  const createStickyInViewCentre = useCallback(() => {
    const camera = cameraRef.current.camera;
    const size = viewportRef.current;
    createStickyAt(
      screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }),
    );
  }, [createStickyAt]);

  // Prune selection when snapshot changes.
  useEffect(() => {
    const present = new Set(objects.map((n) => n.id));
    selection.prune(present);
  }, [objects, selection]);

  // --- Transform gesture wiring ---
  const gestureOptsRef = useRef<import('./board/useTransformGesture').TransformGestureOptions>({
    doc: board.doc,
    camera: cameraApi.camera,
    selection,
    snapshot: objects,
    canEdit,
    undo: undoController,
  });
  gestureOptsRef.current = {
    doc: board.doc,
    camera: cameraApi.camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart,
    onGestureEnd,
    onResizeComplete: (ids: readonly string[]) => {
      for (const id of ids) {
        const obj = objectsRef.current.find((o) => o.id === id);
        if (obj?.type === 'text') {
          const objMap = boardRef.current.doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
          if (objMap) {
            const w = objMap.get('width') as number;
            if (typeof w === 'number' && Number.isFinite(w)) {
              setTextWidthFixed(boardRef.current.doc, id, w);
            }
          }
          const boxSync = createTextBoxSync(boardRef.current.doc, id, measurerRef.current);
          boxSync.remeasureAfterLocalChange();
        }
      }
    },
    undo: undoController,
  };

  const gesture = useTransformGesture(gestureOptsRef);

  // --- Keyboard ---
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const setToolRef = useRef(setTool);
  setToolRef.current = setTool;

  const keysOptsRef = useRef({
    doc: board.doc,
    selection,
    snapshot: objects,
    canEdit,
    undo: undoController,
    toolRef,
    setToolRef,
  });
  keysOptsRef.current = {
    doc: board.doc,
    selection,
    snapshot: objects,
    canEdit,
    undo: undoController,
    toolRef,
    setToolRef,
  };
  useBoardKeys(keysOptsRef);

  // --- Marquee ---
  const marquee = useMarquee(
    { get current() { return cameraRef.current.camera; } },
    { get current() { return objectsRef.current; } },
    useCallback((ids: string[]) => {
      selection.setMany(ids, false);
    }, [selection]),
  );
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

  const camera = cameraApi.camera;

  const stackPeople: readonly Person[] = presence.board;

  // Story 9: text tool creates text on click.
  const toolRefForClick = useRef(tool);
  toolRefForClick.current = tool;

  const setToolRefForClick = useRef(setTool);
  setToolRefForClick.current = setTool;

  const handleSurfaceClick = useCallback(
    (point: Point) => {
      if (toolRefForClick.current === 'text') {
        // Create text at this point.
        const identity = { id: 'local' };
        const id = createText(boardRef.current.doc, point, identity.id);
        if (id) {
          setToolRefForClick.current('select');
          selection.startEdit(id);
        }
        return;
      }
      selection.clear();
    },
    [selection],
  );

  // Publish selection for presence: single-selection only.
  useEffect(() => {
    const ids = [...selection.ids];
    presenceRef.current.setSelection(ids.length === 1 ? ids[0]! : null);
  }, [selection.ids]);

  const handleSurfaceDoubleClick = useCallback(
    (point: Point) => {
      createStickyAt(point);
    },
    [createStickyAt],
  );

  const deleteNote = useCallback(
    (id: string) => {
      // One bin click is one undo step (story 8).
      undoController.boundary();
      deleteObject(boardRef.current.doc, id);
      undoController.boundary();
      selection.clear();
    },
    [selection, undoController],
  );

  const handleDeleteSelection = useCallback(() => {
    const ids = [...selection.ids];
    if (ids.length > 0) {
      undoController.boundary();
      deleteObjects(boardRef.current.doc, ids);
      undoController.boundary();
      selection.clear();
    }
  }, [selection, undoController]);

  // Find the selected object if it's a single text object (for TextToolbar).
  let selectedTextObj: ObjectSnapshot | undefined;
  if (selection.ids.size === 1) {
    const id = [...selection.ids][0]!;
    selectedTextObj = objects.find((o) => o.id === id && o.type === 'text');
  }

  // Screen-space bounding box for the selection bar.
  const selectedCount = selection.ids.size;
  let barTop = 0;
  let barLeft = 0;
  if (selectedCount > 0) {
    const rects: ReturnType<typeof objectBounds>[] = [];
    for (const n of objects) {
      if (selection.ids.has(n.id)) rects.push(objectBounds(n));
    }
    const bb = unionRects(rects);
    if (bb) {
      const s = worldToScreen(camera, { x: bb.x, y: bb.y });
      barTop = s.y;
      barLeft = s.x;
    }
  }

  // --- Text toolbar handlers ---
  const handleTextSizeChange = useCallback(
    (size: TextSize) => {
      if (selection.ids.size !== 1) return;
      const id = [...selection.ids][0]!;
      const obj = objectsRef.current.find((o) => o.id === id);
      if (!obj || obj.type !== 'text') return;
      undoController.boundary();
      setTextSize(boardRef.current.doc, id, size);
      // Remeasure box.
      const boxSync = createTextBoxSync(boardRef.current.doc, id, measurerRef.current);
      boxSync.remeasureAfterLocalChange();
      undoController.boundary();
    },
    [selection, undoController],
  );

  const handleTextDelete = useCallback(() => {
    if (selection.ids.size === 1) {
      const id = [...selection.ids][0]!;
      deleteNote(id);
    }
  }, [selection, deleteNote]);

  return (
    <CameraContext.Provider value={cameraApi}>
      <div className="board-area" data-testid="board-area" ref={boardAreaRef}>
        <BoardViewport
          tool={tool}
          onSurfaceClick={handleSurfaceClick}
          onSurfaceDoubleClick={handleSurfaceDoubleClick}
          marqueeRef={marqueeRef}
        >
          {objects.map((obj) => {
            if (obj.type === 'text') {
              return (
                <TextObject
                  key={obj.id}
                  id={obj.id}
                  x={obj.x}
                  y={obj.y}
                  width={obj.width}
                  height={obj.height}
                  size={obj.size}
                  editing={selection.editingId === obj.id}
                  selected={selection.ids.has(obj.id)}
                  canEdit={canEdit}
                  doc={board.doc}
                  camera={camera}
                  onSelect={(id) => selection.click(id)}
                  onStartEdit={(id) => selection.startEdit(id)}
                  onEndEdit={(next) => selection.endEdit(next)}
                  onDelete={deleteNote}
                  undo={undoController}
                />
              );
            }
            // Sticky note rendering (story 2).
            return (
              <StickyNote
                key={obj.id}
                note={obj}
                doc={board.doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={selection.editingId === obj.id}
                multiSelected={selectedCount > 1 && selection.ids.has(obj.id)}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onToggleSelect={selection.toggle}
                onSelect={(id) => selection.click(id)}
                onStartEdit={(id) => selection.startEdit(id)}
                onEndEdit={(next) => selection.endEdit(next)}
                onDelete={deleteNote}
                undo={undoController}
              />
            );
          })}
        </BoardViewport>
        <RemoteSelections
          people={presence.selections}
          objects={objects}
          camera={camera}
          size={STICKY_SIZE_WORLD}
        />
        <RemoteCursors
          people={toScreenPeople(presence.cursors, camera)}
          now={presence.now}
          viewport={viewport}
        />
        {selection.ids.size > 0 ? (
          <SelectionOverlay
            ids={selection.ids}
            snapshot={objects}
            camera={camera}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
        ) : null}
        {selectedCount === 1 && selectedTextObj && selectedTextObj.type === 'text' ? (
          <div
            data-testid="selection-bar-anchor"
            style={{
              position: 'absolute',
              left: barLeft,
              top: barTop,
              pointerEvents: 'none',
              width: 0,
              height: 0,
              zIndex: 30,
            }}
          >
            <TextSelectionBar
              size={selectedTextObj.size}
              onSize={handleTextSizeChange}
              onDelete={handleTextDelete}
            />
          </div>
        ) : null}
        {selectedCount > 1 ? (
          <div
            data-testid="selection-bar-anchor"
            style={{
              position: 'absolute',
              left: barLeft,
              top: barTop,
              pointerEvents: 'none',
              width: 0,
              height: 0,
              zIndex: 30,
            }}
          >
            <SelectionBar count={selectedCount} onDelete={handleDeleteSelection} />
          </div>
        ) : null}
        <MarqueeRect rect={marquee.rect} camera={camera} />
        <div className="presence-area" data-testid="presence-area">
          <PresenceStack people={stackPeople} now={presence.now} selfId={presence.selfId} />
          <PresenceIdentity
            name={presence.self.name}
            onRename={(raw) => presenceRef.current.rename(raw)}
          />
        </div>
        <Toolbar
          onCreateSticky={createStickyInViewCentre}
          undo={undoState}
          tool={tool}
          onToolChange={setTool}
          canEdit={canEdit}
        />
        <div className="connection-area">
          {broken ? (
            <p className="board-link-warning" data-testid="board-link-warning" role="status">
              That link is not a board, so this board is yours alone. Copy the
              address bar to share <em>this</em> board.
            </p>
          ) : null}
          <ConnectionStatus state={connectionState} />
        </div>
      </div>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={() => cameraApi.reset()}
      />
      <NavigationHint visible={!cameraApi.hasNavigated} />
    </CameraContext.Provider>
  );
}