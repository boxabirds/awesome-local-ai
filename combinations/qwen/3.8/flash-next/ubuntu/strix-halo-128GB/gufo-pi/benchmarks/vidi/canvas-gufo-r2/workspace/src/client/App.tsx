import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Camera } from './canvas/camera';
import { BoardViewport, useBoardCamera } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type SelectionApi } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import { TextToolbar } from './objects/TextToolbar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useTool, type Tool } from './board/useTool';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { getObjectType } from './objects/registry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  type ObjectSnapshot,
} from '../shared/board-model';
import { createText, setTextSize } from '../shared/objects/text';
import type { TextSize } from '../shared/config';
import { type StickyColor } from '../shared/config';
import type { Point } from './canvas/camera';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SharePanel } from './share/SharePanel';

/** Imperative bridge so callbacks defined outside the viewport can read the
 * current camera and convert points using the live viewport size. */
interface BoardBridge {
  toWorld(screenPoint: Point): Point;
  viewportCentreWorld(): Point;
  getCamera(): Camera;
}

const FALLBACK_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Screen-space chrome over the board: toolbars, zoom control, hint. */
function BoardChrome(props: {
  connectionState: ReturnType<typeof useBoardDoc>['connectionState'];
  tool: Tool;
  onToolChange(t: Tool): void;
  onCreateSticky(): void;
  undoState: ReturnType<typeof useUndo>;
}): JSX.Element {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();
  const { connectionState, tool, onToolChange, onCreateSticky, undoState } = props;
  const editable = canEdit(connectionState);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <Toolbar tool={tool} onToolChange={onToolChange} onCreateSticky={onCreateSticky} disabled={!editable} undoState={undoState} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** Installs the camera bridge; rendered inside BoardViewport so camera context is available. */
function CameraBridge(props: { register(bridge: BoardBridge | null): void }): null {
  const { camera } = useBoardCamera();
  const registerRef = useRef(props.register);
  registerRef.current = props.register;

  useEffect(() => {
    const el = document.querySelector('[data-testid="board"]') as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const vw = rect?.width || window.innerWidth || 1024;
    const vh = rect?.height || window.innerHeight || 768;
    registerRef.current({
      toWorld: (p) => screenToWorld(camera, p),
      viewportCentreWorld: () => screenToWorld(camera, { x: vw / 2, y: vh / 2 }),
      getCamera: () => camera,
    });
    return () => registerRef.current(null);
  }, [registerRef, camera]);

  return null;
}

/** World-layer board objects, resolved through the object-type registry. */
function BoardObjects(props: {
  objects: readonly ObjectSnapshot[];
  doc: Y.Doc;
  selection: SelectionApi;
  readOnly: boolean;
  onObjectPointerDown: ReturnType<typeof useTransformGesture>['onObjectPointerDown'];
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undo?: UndoController;
}): JSX.Element {
  const { camera } = useBoardCamera();
  const { objects, doc, selection, readOnly } = props;

  return (
    <>
      {[...objects]
        .slice()
        // Stable DOM order (by id) so React never reorders an element mid-drag
        // (reordering can release pointer capture in Chromium). Stacking is the
        // CSS z-index on each object.
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              readOnly={readOnly}
              onObjectPointerDown={props.onObjectPointerDown}
              onStartEdit={props.onStartEdit}
              onEndEdit={props.onEndEdit}
              undo={props.undo}
            />
          );
        })}
    </>
  );
}

/**
 * Board editing is refused while the server cannot load the board: writing to a
 * doc that never received the stored state would produce a board that conflicts
 * with whatever is on the server.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The board UI (stories 1–9). Mounted by BoardPage when the board exists.
 */
export function App(props: { doc?: Y.Doc; boardId?: string } = {}) {
  const boardId = props.boardId ?? getBoardIdFromPath();
  const { doc, notes, connectionState } = useBoardDoc(props.doc, boardId);
  const canEditBoard = canEdit(connectionState);

  // Story 8: one UndoController per board doc, destroyed on board change / unmount.
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);

  const undoState = useUndo(undoController, canEditBoard);

  // Story 9: tool state
  const { tool, setTool } = useTool(canEditBoard);

  const bridgeRef = useRef<BoardBridge | null>(null);
  const registerBridge = useCallback((b: BoardBridge | null) => {
    bridgeRef.current = b;
  }, []);
  const getCamera = useCallback(() => bridgeRef.current?.getCamera() ?? FALLBACK_CAMERA, []);

  const selection = useSelection(notes);

  const gesture = useTransformGesture({
    doc,
    getCamera,
    selection,
    snapshot: notes,
    canEdit: canEditBoard,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  const handleCreateSticky = useCallback(() => {
    if (!canEditBoard) return;
    const b = bridgeRef.current;
    const world = b ? b.viewportCentreWorld() : { x: 0, y: 0 };
    undoController.boundary();
    const id = createSticky(doc, world);
    undoController.boundary();
    selection.click(id);
    selection.startEdit(id);
  }, [canEditBoard, doc, selection, undoController]);

  useBoardKeys({ doc, selection, snapshot: notes, canEdit: canEditBoard, undo: undoController, tool, setTool, onCreateSticky: handleCreateSticky });

  const handleStartEdit = useCallback(
    (id: string) => {
      if (!canEditBoard) return;
      const obj = notes.find((o) => o.id === id);
      if (!obj || !getObjectType(obj.type)?.editableText) return;
      selection.startEdit(id);
    },
    [canEditBoard, notes, selection],
  );

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => selection.endEdit(next),
    [selection],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!canEditBoard || selection.ids.size === 0) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [canEditBoard, doc, selection, undoController]);

  const handleBoardDblClick = useCallback(
    (point: Point) => {
      if (!canEditBoard) return;
      const b = bridgeRef.current;
      const world = b ? b.toWorld(point) : point;
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      selection.click(id);
      selection.startEdit(id);
    },
    [canEditBoard, doc, selection, undoController],
  );

  const handleEmptyClick = useCallback(() => selection.clear(), [selection]);

  // Story 9: when text tool is active, a board click creates text and returns to select
  const handleTextToolClick = useCallback(
    (point: Point) => {
      if (!canEditBoard) return;
      const b = bridgeRef.current;
      const world = b ? b.toWorld(point) : point;
      undoController.boundary();
      const id = createText(doc, world, 'user');
      undoController.boundary();
      if (id) {
        setTool('select');
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [canEditBoard, doc, selection, undoController, setTool],
  );

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!canEditBoard || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setStickyColor(doc, id, color);
      undoController.boundary();
    },
    [canEditBoard, doc, selection, undoController],
  );

  // Story 9: text size change
  const handleTextSize = useCallback(
    (size: TextSize) => {
      if (!canEditBoard || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setTextSize(doc, id, size);
      undoController.boundary();
    },
    [canEditBoard, doc, selection, undoController],
  );

  // NoteToolbar (colour + delete) for a single selected sticky, not editing.
  const selectedSticky: ObjectSnapshot | null =
    canEditBoard && selection.ids.size === 1 && selection.editingId === null
      ? notes.find((n) => n.id === [...selection.ids][0] && n.type === 'sticky') ?? null
      : null;

  // Story 9: TextToolbar for a single selected text object, not editing.
  const selectedText: ObjectSnapshot | null =
    canEditBoard && selection.ids.size === 1 && selection.editingId === null
      ? notes.find((n) => n.id === [...selection.ids][0] && n.type === 'text') ?? null
      : null;

  return (
    <div className="board-container">
      {boardId && <SharePanel boardId={boardId} />}
      <BoardViewport
        snapshot={notes}
        onMarqueeSelect={(ids, additive) => selection.setMany(ids, additive)}
        tool={tool}
        onTextToolClick={handleTextToolClick}
        children={
          <>
            <CameraBridge register={registerBridge} />
            <BoardObjects
              objects={notes}
              doc={doc}
              selection={selection}
              readOnly={!canEditBoard}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={handleStartEdit}
              onEndEdit={handleEndEdit}
              undo={undoController}
            />
          </>
        }
        overlay={
          <>
            <SelectionOverlay
              ids={selection.ids}
              snapshot={notes}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
            <SelectionBar
              count={selection.ids.size}
              ids={selection.ids}
              snapshot={notes}
              onDelete={handleDeleteSelection}
            />
            {selectedSticky && selectedSticky.color && (
              <NoteToolbar
                color={selectedSticky.color}
                onColor={handleColor}
                onDelete={handleDeleteSelection}
              />
            )}
            {selectedText && (
              <TextToolbar
                size={(selectedText.size as TextSize) ?? 'M'}
                onSize={handleTextSize}
                onDelete={handleDeleteSelection}
              />
            )}
            <BoardChrome
              connectionState={connectionState}
              tool={tool}
              onToolChange={setTool}
              onCreateSticky={handleCreateSticky}
              undoState={undoState}
            />
          </>
        }
        onBoardDblClick={handleBoardDblClick}
        onBoardEmptyClick={handleEmptyClick}
      />
    </div>
  );
}

/** Extract board ID from /b/:boardId path. */
function getBoardIdFromPath(): string | undefined {
  const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]+)/);
  return match?.[1];
}

/**
 * Top-level router: renders home, board, or not-found based on route.
 */
export function RouterApp() {
  const route = useRoute();

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
