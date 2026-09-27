// Board page (spec: share.pages state diagram):
//   - malformed id → NotFoundPage, no request;
//   - "Opening board…" while checkBoard runs;
//   - exists → the stories 1–7 board (mounts + connectBoard);
//   - not_found → NotFoundPage;
//   - unreachable → "Couldn't reach vidi6. Retrying…" with exponential
//     backoff from BOARD_CHECK_RETRY_BASE_MS, capped at RECONNECT_MAX_BACKOFF_MS.
// All timers are cleared on unmount.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { BoardViewport } from '../canvas/BoardViewport';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Size,
} from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { installTestHooks } from '../canvas/testHooks';
import { useCamera } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useActiveTool } from '../tools/useActiveTool';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { ShapeToolbar } from '../board/ShapeToolbar';
import { ConnectorTool } from '../tools/ConnectorTool';
import { ShapeTool } from '../tools/ShapeTool';
import { PenToolbar } from '../tools/PenToolbar';
import { PenTool } from '../tools/PenTool';
import { usePenOptions } from '../tools/usePenOptions';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
} from '../../shared/board-model';
import { unionRects, type Rect } from '../../shared/geometry';
import { createText, setTextSize } from '../../shared/objects/text';
import { setShapeStyle, type FillColor, type StrokeColor } from '../../shared/objects/shape';
import { NotFoundPage } from './NotFoundPage';

type Phase = 'checking' | 'exists' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }) {
  // A malformed id never produces a request (TC-19 negative).
  const [phase, setPhase] = useState<Phase>(() =>
    isValidBoardId(id) ? 'checking' : 'not_found',
  );
  // How many checks have already failed (drives the backoff delay).
  const [failedChecks, setFailedChecks] = useState(0);
  const [runId, setRunId] = useState(0); // bump to (re)start a check cycle

  useEffect(() => {
    if (phase === 'exists' || phase === 'not_found') return;
    const delay =
      phase === 'unreachable' && failedChecks > 0
        ? Math.min(
            BOARD_CHECK_RETRY_BASE_MS * 2 ** (failedChecks - 1),
            RECONNECT_MAX_BACKOFF_MS,
          )
        : 0;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        if (result.status === 'exists') {
          setPhase('exists');
        } else if (result.status === 'not_found') {
          setPhase('not_found');
        } else {
          setFailedChecks((n) => n + 1);
          setPhase('unreachable');
          setRunId((n) => n + 1);
        }
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, phase, failedChecks, runId]);

  if (phase === 'not_found') return <NotFoundPage />;
  if (phase !== 'exists') {
    return (
      <div className="page board-page">
        <p className="page-status" role="status">
          {phase === 'checking' ? 'Opening board…' : 'Couldn’t reach vidi6. Retrying…'}
        </p>
      </div>
    );
  }
  return <Board boardId={id} />;
}

/**
 * Editing is allowed in every connection state except load_failed
 * (spec: persist.client_status). A load_failed board shows the red badge
 * "This board couldn't be loaded. Retrying…" and the provider keeps
 * retrying; the first successful sync re-enables editing without a reload.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Text tool: objects don't start a move on pointer-down (board.text_tool). */
function noopObjectPointerDown(_e: ReactPointerEvent<HTMLElement>, _id: string): void {
  // Intentionally empty: the click bubbles to the viewport, which creates a
  // text object at the click point.
}

/** Text tool: resize handles don't start a gesture (board.text_tool). */
function noopHandlePointerDown(_e: ReactPointerEvent<HTMLElement>, _handle: string): void {
  // Intentionally empty.
}

/** Gap (screen px) between the selection bar and the box's top edge. */
const NOTE_TOOLBAR_GAP_PX = 8;
/** Selection bar height (screen px); the anchor sits that far above. */
const NOTE_TOOLBAR_HEIGHT_PX = 40;

/** The full board surface (stories 1–7) plus the Share button (story 5). */
function Board({ boardId }: { boardId: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  // Viewport size from a ResizeObserver; camera x,y are unchanged on resize.
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, notes, connectionState, setConnectionState } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);
  const selection = useSelection(notes);

  // Active tool (tools.active_tool): 'select' by default, reverts to
  // 'select' when the board becomes non-editable.
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool(editable, selection);

  // Pen options (story 11): session-only colour + thickness, shared by the
  // Pen toolbar and the Pen tool.
  const pen = usePenOptions();

  // Per-user undo/redo (story 8): one controller per board doc, tracking only
  // this tab's LOCAL_ORIGIN transactions; destroyed on unmount (a board
  // change remounts this component via the page key), so history is
  // session-only (undo.session_only).
  const undoRef = useRef<ReturnType<typeof createUndo> | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undo = undoRef.current;
  useEffect(() => {
    return () => undo.destroy();
  }, [undo]);
  const undoUi = useUndo(undo, editable);

  // Transform gesture: moving (pointer-down on an object) and resizing
  // (pointer-down on an overlay handle) share one implementation. Gesture
  // start/end close undo capture windows so one drag is one step.
  const gestureLogRef = useRef({ starts: 0, ends: 0 });
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: () => {
      gestureLogRef.current.starts += 1;
      undo.boundary();
    },
    onGestureEnd: () => {
      gestureLogRef.current.ends += 1;
      undo.boundary();
    },
  });

  // Marquee (Shift+drag) selection: additive, fully-contained objects only.
  const marquee = useMarquee(cam.camera, notes, (ids) => selection.setMany(ids, true));


  // Keyboard shortcuts: Ctrl+A, Escape, arrows, Delete, Enter, undo/redo,
  // tool switches (V/T) and N for a new sticky at the centre.
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undo,
    tool,
    setTool,
    onCreateStickyCenter: () => createStickyAt({ x: size.width / 2, y: size.height / 2 }),
  });

  // Test-only hook (excluded from production builds).
  useEffect(() => {
    installTestHooks({
      setCamera: cam.setCamera,
      getDoc: () => doc,
      createNoteAt: (x: number, y: number) => createSticky(doc, { x, y }),
      deleteNote: (id: string) => deleteObjects(doc, [id]) > 0,
      connectionState,
      setConnectionState,
      getGestureLog: () => ({ ...gestureLogRef.current }),
      getUndoController: () => undo,
    });
  }, [cam.setCamera, doc, connectionState, setConnectionState]);

  /** Create a note centred on a screen point, then select and start editing it. */
  const createStickyAt = (screenPoint: { x: number; y: number }) => {
    if (!editable) return; // load_failed: no model mutation (persist.client_status)
    const world = screenToWorld(cam.camera, screenPoint);
    undo.boundary();
    const id = createSticky(doc, world);
    undo.boundary();
    if (tool === 'sticky') {
      // One-shot tool: the sticky button creates a single note and reverts
      // to select (like the text tool; sticky.tool_ui, story 3 behaviour).
      setTool('select');
    }
    selection.startEdit(id);
  };

  /**
   * Create a text object with its top-left at the screen point and start
   * editing it (board.text_tool, text.create). The per-tab Yjs clientID is
   * the creator identity (story 6 presence reuses the same per-client id).
   */
  const createTextAt = (screenPoint: { x: number; y: number }) => {
    if (!editable) return;
    const world = screenToWorld(cam.camera, screenPoint);
    undo.boundary();
    const id = createText(doc, world, `c${doc.clientID}`);
    undo.boundary();
    if (id !== null) {
      // The tool reverts to select and the new object is edited immediately
      // (text.tool_ui: click → createText, setTool('select'), start editing).
      setTool('select');
      selection.startEdit(id);
    }
  };

  const selectedObjects = notes.filter((n) => selection.ids.has(n.id));

  // Live rects of every attachable object (connector endpoint resolution,
  // story 10). Rebuilt on every snapshot; connectors are excluded.
  const attachableRects: ReadonlyMap<string, Rect> = (() => {
    const m = new Map<string, Rect>();
    for (const n of notes) {
      if (n.type === 'connector') continue;
      m.set(n.id, objectBounds(n));
    }
    return m;
  })();
  const singleShape =
    editable && selection.ids.size === 1
      ? (() => {
          const [id] = selection.ids.values();
          const o = notes.find((n) => n.id === id);
          return o !== undefined && o.type === 'shape' ? o : null;
        })()
      : null;
  const showBar =
    editable &&
    selection.editingId === null &&
    (selectedObjects.length >= 2 ||
      (selectedObjects.length === 1 &&
        selectedObjects[0] !== undefined &&
        (selectedObjects[0].type === 'sticky' || selectedObjects[0].type === 'text')));

  // Selection bar + overlay: screen space, anchored on the bounding box.
  let selectionBar = null;
  if (showBar) {
    const box = unionRects(selectedObjects.map(objectBounds));
    if (box !== null) {
      const anchor = worldToScreen(cam.camera, { x: box.x + box.width / 2, y: box.y });
      selectionBar = (
        <div
          className="note-toolbar-anchor"
          style={{
            left: anchor.x,
            top: anchor.y - NOTE_TOOLBAR_GAP_PX - NOTE_TOOLBAR_HEIGHT_PX,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onColor={(color) => {
              const [id] = selection.ids.values();
              if (id !== undefined) {
                undo.boundary();
                setStickyColor(doc, id, color);
                undo.boundary();
              }
            }}
            onTextSize={(size) => {
              const [id] = selection.ids.values();
              if (id !== undefined) {
                undo.boundary();
                setTextSize(doc, id, size);
                undo.boundary();
              }
            }}
            onDelete={() => {
              undo.boundary();
              deleteObjects(doc, [...selection.ids]);
              undo.boundary();
              selection.clear();
            }}
          />
        </div>
      );
    }
  }

  // Shape toolbar (shape.style): shown above a single selected shape.
  let shapeToolbar = null;
  if (singleShape !== null && selection.editingId === null) {
    const box = objectBounds(singleShape);
    const anchor = worldToScreen(cam.camera, { x: box.x + box.width / 2, y: box.y });
    shapeToolbar = (
      <div
        className="note-toolbar-anchor"
        style={{
          left: anchor.x,
          top: anchor.y - NOTE_TOOLBAR_GAP_PX - NOTE_TOOLBAR_HEIGHT_PX,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <ShapeToolbar
          kind={singleShape.kind ?? 'rect'}
          fill={(singleShape.fill ?? 'white') as FillColor}
          stroke={(singleShape.stroke ?? 'dark') as StrokeColor}
          onFill={(color) => {
            undo.boundary();
            setShapeStyle(doc, singleShape.id, { fill: color });
            undo.boundary();
          }}
          onStroke={(color) => {
            undo.boundary();
            setShapeStyle(doc, singleShape.id, { stroke: color });
            undo.boundary();
          }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="app-root">
      <BoardViewport
        cam={cam}
        onEmptyClick={() => selection.clear()}
        onCreateStickyAt={createStickyAt}
        textToolActive={tool === 'text'}
        onCreateTextAt={createTextAt}
        stickyToolActive={tool === 'sticky'}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        screenOverlays={
          tool === 'pen' ? (
            <PenTool
              camera={cam.camera}
              color={pen.color}
              thickness={pen.thickness}
              doc={doc}
              identityId={`c${doc.clientID}`}
              undo={undo}
            />
          ) : undefined
        }
      >
        <MarqueeRect rect={marquee.rect} />
        {notes.map((note) => {
          const spec = getObjectType(note.type);
          if (spec === undefined) return null; // unknown type: not rendered
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              snapshot={notes}
              doc={doc}
              camera={cam.camera}
              zoom={cam.camera.zoom}
              rects={attachableRects}
              selected={selection.ids.has(note.id)}
              editing={selection.editingId === note.id}
              dragging={gesture.draggingIds.has(note.id)}
              editable={editable}
              // Text tool: clicking an object creates text at the click
              // point instead of starting a move (board.text_tool).
              onObjectPointerDown={tool === 'text' ? noopObjectPointerDown : gesture.onObjectPointerDown}
              onFocusSelect={(id) => selection.click(id)}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              undo={undo}
            />
          );
        })}
      </BoardViewport>
      {tool === 'shape' && (
        <ShapeTool
          kind={shapeKind}
          doc={doc}
          camera={cam.camera}
          undo={undo}
          by={`c${doc.clientID}`}
          onCreated={toolCreated}
        />
      )}
      {tool === 'connector' && (
        <ConnectorTool
          camera={cam.camera}
          snapshot={notes}
          doc={doc}
          undo={undo}
          by={`c${doc.clientID}`}
          onCreated={toolCreated}
        />
      )}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={cam.camera}
        onHandlePointerDown={tool === 'text' ? noopHandlePointerDown : gesture.onHandlePointerDown}
      />
      <Toolbar
        disabled={!editable}
        undo={undoUi}
        tool={tool}
        shapeKind={shapeKind}
        onToolChange={setTool}
        onShapeKindChange={setShapeKind}
      />
      {tool === 'pen' && (
        <div className="pen-toolbar-anchor" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <PenToolbar
            color={pen.color}
            thickness={pen.thickness}
            onColor={pen.setColor}
            onThickness={pen.setThickness}
          />
        </div>
      )}
      {selectionBar}
      {shapeToolbar}
      {selection.ids.size > 0 && (
        <span data-testid="selection-count" aria-live="polite" className="sr-only">
          {selection.ids.size} selected
        </span>
      )}
      <ConnectionStatus state={connectionState} />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
