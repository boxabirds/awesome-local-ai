import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObjects, setStickyColor } from '../../shared/board-model';
import { isValidBoardId, newBoardId } from '../../shared/board-id';
import { DEFAULT_TEXT_SIZE } from '../../shared/config';
import { createText, getTextFields, setTextSize } from '../../shared/objects/text';
import { getShapeFields, setShapeStyle } from '../../shared/objects/shape';
import { checkBoard } from '../api';
import { identity } from '../identity';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { Toolbar } from '../board/Toolbar';
import { createUndo } from '../board/undo';
import { useBoardDoc } from '../board/useBoardDoc';
import { useBoardKeys } from '../board/useBoardKeys';
import { useSelection } from '../board/useSelection';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenToolbar } from '../tools/PenToolbar';
import { PenTool } from '../tools/PenTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ShapeToolbar } from '../tools/ShapeToolbar';
import { useActiveTool } from '../tools/useActiveTool';
import { usePenOptions } from '../tools/usePenOptions';
import { useTransformGesture } from '../board/useTransformGesture';
import { useUndo } from '../board/useUndo';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size
} from '../canvas/camera';
import { installTestHooks } from '../canvas/testHooks';
import { BoardCameraContext, useCamera } from '../canvas/useCamera';
import { getObjectType } from '../objects/registry';
import { STICKY_PADDING_WORLD } from '../objects/StickyNote';
import { createCanvasMeasurer } from '../objects/textLayout';
import { TextToolbar } from '../objects/TextToolbar';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import { SharePanel } from '../share/SharePanel';
import { ConnectionStatus, useConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

const NOTE_TOOLBAR_GAP_PX = 12;

// Editing is disabled only while the board cannot be loaded, so a transient
// storage failure ("Reconnecting…") never locks a readable board (TC-28).
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

// A board id read from /b/<id> for a standalone board (component tests render
// <BoardView/> directly); falls back to a fresh id, as before story 5. Inside
// BoardPage the id is always supplied explicitly.
function resolveLocationBoardId(): string {
  const match = /^\/b\/([^/]+)\/?$/.exec(window.location.pathname);
  if (match !== null && isValidBoardId(match[1])) return match[1];
  const fresh = newBoardId();
  window.history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}

function measure(el: HTMLElement | null): Size {
  const width = el?.clientWidth || window.innerWidth;
  const height = el?.clientHeight || window.innerHeight;
  return { width, height };
}

export interface BoardViewProps {
  // Tests inject their own Y.Doc; production supplies none (sync via boardId).
  doc?: Y.Doc;
  boardId?: string;
}

// The board UI, rendered once the board is known to exist. With a doc
// injected it stays offline (component tests); with a boardId it syncs.
// Story 7: objects of every registered type render through the registry and
// share generic selection, move, resize, delete and keyboard behaviour.
export function BoardView({ doc: providedDoc, boardId }: BoardViewProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>(() => measure(null));
  useEffect(() => {
    const update = () => {
      const next = measure(rootRef.current);
      setViewport((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      );
    };
    update();
    const el = rootRef.current;
    if (typeof ResizeObserver !== 'undefined' && el !== null) {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const board = useCamera(viewport);
  // Injected docs (component tests) stay offline; real boards sync live.
  const [resolvedId] = useState(() => boardId ?? resolveLocationBoardId());
  const { doc, notes, objects, connection } = useBoardDoc(
    providedDoc,
    providedDoc === undefined ? resolvedId : undefined
  );
  const connectionStatus = useConnectionStatus(connection);
  const editable = canEdit(connectionStatus);
  const selection = useSelection(objects);
  const { editingId } = selection;

  // This tab's own history, one per doc. It never leaves the tab: only
  // LOCAL_ORIGIN transactions are captured (design §Undo controller).
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);
  const undoState = useUndo(undoController, editable);

  // Shared width measurer for the text box sync (typing, size changes and
  // handle drags all re-measure through this one canvas context).
  const textMeasurer = useMemo(() => createCanvasMeasurer(), []);

  // Local-only flag: hides the floating toolbar while a gesture runs.
  const [dragging, setDragging] = useState(false);
  const onGestureStart = useCallback(() => {
    // Close the previous capture window so this gesture is its own step.
    undoController.boundary();
    setDragging(true);
  }, [undoController]);
  const onGestureEnd = useCallback(() => {
    // Close this gesture's window so the next change is never merged into it.
    undoController.boundary();
    setDragging(false);
  }, [undoController]);

  const gesture = useTransformGesture({
    doc,
    camera: board.camera,
    objects,
    selection,
    canEdit: editable,
    measureText: textMeasurer,
    onGestureStart,
    onGestureEnd
  });
  const marquee = useMarquee(board.camera, objects, selection);

  const createAtWorldPoint = useCallback(
    (world: Point) => {
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      selection.startEdit(id);
    },
    [doc, selection, undoController]
  );

  const onCreateSticky = useCallback(() => {
    if (!editable) return; // load-failed board is never editable (TC-23)
    // Centre of the visible board area, wherever the board has been panned.
    createAtWorldPoint(
      screenToWorld(board.camera, { x: viewport.width / 2, y: viewport.height / 2 })
    );
  }, [board.camera, createAtWorldPoint, viewport, editable]);

  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    selection
  });
  // Pen colour/thickness: session-only, never synced (story 11).
  const pen = usePenOptions();
  // Each committed stroke (or split part) is its own undo step: close the
  // capture window right after createStroke (undoManager.stopCapturing()).
  const onPenCommitted = useCallback(() => {
    undoController.boundary();
  }, [undoController]);

  // A tool-created object becomes the selection and the board returns to
  // Select (tools.return_to_select); the undo step is bounded around it.
  const onToolCreated = useCallback(
    (id: string) => {
      undoController.boundary();
      toolCreated(id);
      undoController.boundary();
    },
    [toolCreated, undoController]
  );

  // Text tool click (story 9): create text whose top-left is the clicked
  // world point, start editing it immediately and hand the board back to the
  // Select tool so the next click selects/moves instead of creating.
  const onTextToolClick = useCallback(
    (screenPoint: Point) => {
      if (!editable) return;
      setTool('select');
      const world = screenToWorld(board.camera, screenPoint);
      undoController.boundary();
      const id = createText(doc, world, identity.id);
      if (id !== null) {
        undoController.boundary();
        selection.startEdit(id);
      }
      undoController.boundary();
    },
    [board.camera, doc, editable, selection, setTool, undoController]
  );

  useBoardKeys({
    doc,
    objects,
    selection,
    canEdit: editable,
    undo: undoController,
    onCreateSticky
  });

  useEffect(() => {
    installTestHooks(board.setCamera, doc, connection);
  }, [board.setCamera, doc, connection]);

  const onDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      if (!editable) return; // load-failed board is never editable (TC-23)
      createAtWorldPoint(screenToWorld(board.camera, screenPoint));
    },
    [board.camera, createAtWorldPoint, editable]
  );

  const { camera, hasNavigated } = board;
  const selectionCount = selection.ids.size;

  // Exactly one editable-text object selected (sticky): story 2 floating
  // toolbar; two or more: the multi-select bar.
  const singleId = selectionCount === 1 ? [...selection.ids][0] : null;
  const singleNote = singleId === null ? undefined : notes.find((n) => n.id === singleId);
  const singleText =
    singleId === null ? undefined : objects.find((o) => o.id === singleId && o.type === 'text');
  const singleShape =
    singleId === null ? undefined : objects.find((o) => o.id === singleId && o.type === 'shape');
  const showNoteToolbar =
    editable && singleNote !== undefined && editingId === null && !dragging;
  const showTextToolbar =
    editable && singleText !== undefined && editingId === null && !dragging;
  const showShapeToolbar =
    editable && singleShape !== undefined && editingId === null && !dragging;
  const showSelectionBar = editable && selectionCount >= 2 && !dragging;

  const deleteSelection = useCallback(() => {
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
    undoController.boundary();
  }, [doc, selection, undoController]);

  return (
    <BoardCameraContext.Provider value={board}>
      <div
        ref={rootRef}
        className="board-root"
        style={{ '--sticky-padding': `${STICKY_PADDING_WORLD}px` } as React.CSSProperties}
      >
        <ConnectionStatus status={connectionStatus} />
        <BoardViewport
          onDoubleClickEmpty={onDoubleClickEmpty}
          onEmptyClick={() => {
            selection.clear();
          }}
          marquee={marquee}
          textTool={tool === 'text'}
          onTextToolClick={onTextToolClick}
        >
          {objects.map((obj) => {
            const spec = getObjectType(obj.type);
            if (spec === undefined) return null; // unknown type: invisible
            const { Component } = spec;
            return (
              <Component
                key={obj.id}
                obj={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={obj.id === editingId}
                editable={editable}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onStartEdit={selection.startEdit}
                onEndEdit={selection.endEdit}
                undo={undoController}
              />
            );
          })}
          {marquee.rect !== null && <MarqueeRect rect={marquee.rect} />}
        </BoardViewport>
        {tool === 'shape' && editable && (
          <ShapeTool
            kind={shapeKind}
            camera={camera}
            doc={doc}
            userId={identity.id}
            onCreated={onToolCreated}
          />
        )}
        {tool === 'connector' && editable && (
          <ConnectorTool doc={doc} camera={camera} userId={identity.id} onCreated={onToolCreated} />
        )}
        {tool === 'pen' && editable && (
          <PenTool
            camera={camera}
            color={pen.color}
            thickness={pen.thickness}
            doc={doc}
            identityId={identity.id}
            onCommitted={onPenCommitted}
          />
        )}
        <Toolbar
          onCreateSticky={onCreateSticky}
          tool={tool}
          onSelectTool={setTool}
          shapeKind={shapeKind}
          onSelectShapeKind={setShapeKind}
          disabled={!editable}
          undo={undoState}
        />
        {tool === 'pen' && editable && (
          <PenToolbar
            color={pen.color}
            thickness={pen.thickness}
            onColor={pen.setColor}
            onThickness={pen.setThickness}
          />
        )}
        {editable && (
          <SelectionOverlay
            objects={objects}
            camera={camera}
            selectedIds={selection.ids}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
        )}
        {showNoteToolbar && singleNote !== undefined && (
          <div
            className="note-toolbar-anchor"
            style={{
              left: worldToScreen(camera, {
                x: singleNote.x + (singleNote.width ?? 200) / 2,
                y: singleNote.y
              }).x,
              top:
                worldToScreen(camera, { x: singleNote.x, y: singleNote.y }).y -
                NOTE_TOOLBAR_GAP_PX
            }}
          >
            <SelectionBar
              count={1}
              singleSticky={{ color: singleNote.color }}
              onColor={(color) => {
                undoController.boundary();
                setStickyColor(doc, singleNote.id, color);
                undoController.boundary();
              }}
              onDelete={() => {
                undoController.boundary();
                deleteObjects(doc, [singleNote.id]);
                selection.clear();
                undoController.boundary();
              }}
            />
          </div>
        )}
        {showTextToolbar && singleText !== undefined && (
          <div
            className="note-toolbar-anchor"
            style={{
              left: worldToScreen(camera, {
                x: singleText.x + (singleText.width ?? 0) / 2,
                y: singleText.y
              }).x,
              top:
                worldToScreen(camera, { x: singleText.x, y: singleText.y }).y -
                NOTE_TOOLBAR_GAP_PX
            }}
          >
            <TextToolbar
              size={getTextFields(doc, singleText.id)?.size ?? DEFAULT_TEXT_SIZE}
              onSize={(size) => {
                undoController.boundary();
                setTextSize(doc, singleText.id, size);
                // Top-left stays put; the box re-measures for the new font.
                remeasureTextBox(doc, singleText.id, textMeasurer);
                undoController.boundary();
              }}
              onDelete={() => {
                undoController.boundary();
                deleteObjects(doc, [singleText.id]);
                selection.clear();
                undoController.boundary();
              }}
            />
          </div>
        )}
        {showShapeToolbar &&
          singleShape !== undefined &&
          (() => {
            const shapeFields = getShapeFields(doc, singleShape.id);
            if (shapeFields === undefined) return null;
            return (
              <div
                className="note-toolbar-anchor"
                style={{
                  left: worldToScreen(camera, {
                    x: singleShape.x + (singleShape.width ?? 0) / 2,
                    y: singleShape.y
                  }).x,
                  top:
                    worldToScreen(camera, { x: singleShape.x, y: singleShape.y }).y -
                    NOTE_TOOLBAR_GAP_PX
                }}
              >
                <ShapeToolbar
                  fill={shapeFields.fill}
                  stroke={shapeFields.stroke}
                  onFill={(fill) => {
                    undoController.boundary();
                    setShapeStyle(doc, singleShape.id, { fill });
                    undoController.boundary();
                  }}
                  onStroke={(stroke) => {
                    undoController.boundary();
                    setShapeStyle(doc, singleShape.id, { stroke });
                    undoController.boundary();
                  }}
                />
              </div>
            );
          })()}
        {showSelectionBar && (
          <div className="selection-bar-anchor">
            <SelectionBar
              count={selectionCount}
              onColor={() => undefined}
              onDelete={deleteSelection}
            />
          </div>
        )}
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </div>
    </BoardCameraContext.Provider>
  );
}

// Opening a board link (share.open_link / not_found / unreachable): validate
// the id shape first (malformed → not found, no request), then poll existence
// with exponential backoff while the service is unreachable. The board UI is
// mounted only once the board is known to exist.
export function BoardPage({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' }
  );
  const stateRef = useRef(state);

  useEffect(() => {
    if (!isValidBoardId(id)) {
      const notFound: BoardPageState = { kind: 'not_found' };
      stateRef.current = notFound;
      setState(notFound);
      return;
    }
    const checking: BoardPageState = { kind: 'checking' };
    stateRef.current = checking;
    setState(checking);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      const result = await checkBoard(id);
      if (cancelled) return;
      const prev = stateRef.current;
      const attempt = prev.kind === 'unreachable' ? prev.attempt : 0;
      const next = nextBoardPageState(prev, result, attempt, id);
      stateRef.current = next;
      setState(next);
      if (next.kind === 'unreachable') {
        timer = setTimeout(run, next.nextRetryMs);
      }
    };
    run();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id]);

  if (state.kind === 'checking') {
    return (
      <main className="page board-loading" role="status">
        Opening board…
      </main>
    );
  }
  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'unreachable') {
    return (
      <main className="page board-unreachable" role="status">
        Couldn't reach vidi6. Retrying…
      </main>
    );
  }
  return (
    <>
      <BoardView boardId={id} />
      <SharePanel boardId={id} />
    </>
  );
}
