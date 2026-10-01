import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTool } from '../board/useTool';
import { useActiveTool } from '../tools/useActiveTool';
import { useTransformGesture } from '../board/useTransformGesture';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useBoardKeys } from '../board/useBoardKeys';
import { createUndo, type UndoController } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { Toolbar } from '../board/Toolbar';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, worldToScreen } from '../canvas/camera';
import type { Size, Point } from '../canvas/camera';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { createText, setTextSize } from '../../shared/objects/text';
import { setShapeStyle } from '../../shared/objects/shape';
import { createCanvasMeasurer, remeasureTextObject } from '../objects/textLayout';
import { getObjectType, objectAtPoint } from '../objects/registry';
import { useImageInsert } from '../images/useImageInsert';
import { useToast, ToastContainer } from '../ui/Toast';
import { DropHighlight } from '../images/DropHighlight';
import { deleteObjects as deleteObjectsModel } from '../../shared/board-model';
import { ImageObject } from '../objects/ImageObject';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import {
  STICKY_SIZE_WORLD,
  TEXT_FONT_FAMILY,
  type StickyColor,
  type TextSize,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';
import { nextBoardPageState, type BoardPageState } from './state';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

/**
 * Story 5: board page (share.open_link, share.not_found).
 * On open: show "Opening board…", check existence with exponential backoff
 * (1 s → 2 s → …), render the board only when it exists, the not-found
 * page when it does not, and "Couldn't reach vidi6. Retrying…" while
 * unreachable (the board opens automatically once the service recovers).
 */
export function BoardPage(props: { id: string }) {
  const { id } = props;
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runCheck = async () => {
      const attempt = ++attemptRef.current;
      setState({ kind: 'checking' });
      const result = await checkBoard(id);
      if (cancelled) return;
      const next = nextBoardPageState({ kind: 'checking' }, result, attempt);
      if (next.kind === 'ready') {
        setState({ kind: 'ready', boardId: id });
      } else if (next.kind === 'unreachable') {
        setState(next);
        timer = setTimeout(runCheck, next.nextRetryMs);
      } else {
        setState(next);
      }
    };

    runCheck();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [id]);

  if (state.kind === 'checking') {
    return <MessageScreen data-testid="board-checking" message="Opening board…" />;
  }
  if (state.kind === 'unreachable') {
    return (
      <MessageScreen data-testid="board-unreachable" message="Couldn't reach vidi6. Retrying…" />
    );
  }
  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  // ready: the board (stories 1–4 UI) + the Share button (top-right)
  return (
    <>
      <Board boardId={state.boardId} />
      <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 40 }}>
        <SharePanel boardId={state.boardId} />
      </div>
    </>
  );
}

function MessageScreen(props: { 'data-testid': string; message: string }) {
  return (
    <div
      data-testid={props['data-testid']}
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#555',
        fontSize: 16,
      }}
    >
      {props.message}
    </div>
  );
}

/**
 * The board (stories 1–4 UI), extracted from App.tsx. Mounted by BoardPage
 * only after the existence check succeeds.
 *
 * Story 7: selection is a Set (useSelection), objects render through the
 * type registry, group gestures live in useTransformGesture, the marquee in
 * useMarquee, and keyboard shortcuts in useBoardKeys.
 *
 * Story 8: one per-client `UndoController` per board doc. It is created with
 * the doc, destroyed on unmount (BoardPage remounts `Board` via
 * `key={boardId}` on board change), and its history is session-only — never
 * persisted, never shared with peers.
 */
function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);

  const { doc, objects: notes, connectionState } = useBoardDoc(boardId);
  const sel = useSelection(notes);
  const [gestureActive, setGestureActive] = useState(false);

  const editable = canEdit(connectionState);

  // Story 9: Select/Text tool state (T / V / Escape / N shortcuts).
  const toolState = useTool(editable);
  // Story 10: extended active tool with shape/connector support.
  const activeTool = useActiveTool({
    canEdit: editable,
    select: (id: string) => sel.click(id),
  });
  // Story 11: pen options (colour + thickness), independent of the doc.
  const penOptions = usePenOptions();
  // Story 6 (identity) is not in this build: createdBy uses a per-session id.
  const clientIdRef = useRef<string>('');
  if (clientIdRef.current === '') clientIdRef.current = crypto.randomUUID();
  // Story 12: image insert (drop, paste, picker)
  const { toasts, show: showToast } = useToast();
  const imageInsert = useImageInsert({
    doc,
    boardId,
    camera: cam.camera,
    connection: connectionState,
    identityId: clientIdRef.current,
    viewportSize: viewport,
    showToast,
  });
  // Story 9: text measurement (canvas-based; estimate fallback without DOM).
  const measurerRef = useRef<ReturnType<typeof createCanvasMeasurer> | null>(null);
  if (measurerRef.current === null) measurerRef.current = createCanvasMeasurer(TEXT_FONT_FAMILY);

  // Story 8: the per-client undo history for this board doc.
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undo = undoRef.current;
  useEffect(() => {
    return () => {
      undoRef.current?.destroy();
    };
  }, []);
  const undoControls = useUndo(undo, editable);

  // Story 7: group gestures + marquee + keyboard shortcuts.
  // Story 8: a gesture is one undo step — boundaries bracket it.
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection: sel,
    snapshot: notes,
    canEdit: editable,
    captureRoot: () => viewportElRef.current,
    measurer: measurerRef.current ?? undefined,
    onGestureStart: () => {
      setGestureActive(true);
      undo.boundary();
    },
    onGestureEnd: () => {
      setGestureActive(false);
      undo.boundary();
    },
  });
  const marquee = useMarquee(cam.camera, notes, (ids, additive) =>
    sel.setMany(ids, additive),
  );

  // Escape cancels an in-progress marquee (useBoardKeys skips it meanwhile).
  useEffect(() => {
    if (marquee.rect === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        marquee.cancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [marquee.rect, marquee.cancel]);

  useEffect(() => {
    (window as any).__VIDI_DEBUG__ = { doc };
  }, [doc]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Zoom keyboard shortcuts (story 1)
  const zoomStep = cam.zoomStep;
  const reset = cam.reset;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomStep, reset]);

  // Sticky note creation (gated by canEdit). Story 8: one undo step.
  const createAtScreen = useCallback(
    (screenPoint: Point) => {
      if (!editable) return;
      const world = screenToWorld(cam.camera, screenPoint);
      undo.boundary();
      const id = createSticky(doc, world);
      undo.boundary();
      if (id) sel.startEdit(id);
    },
    [cam.camera, doc, sel, editable, undo],
  );

  const createAtCenter = useCallback(() => {
    if (!editable) return;
    const center: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtScreen(center);
  }, [createAtScreen, viewport.width, viewport.height, editable]);

  useBoardKeys({
    doc,
    selection: sel,
    snapshot: notes,
    canEdit: editable,
    marqueeActive: () => marquee.rect !== null,
    undo,
    tool: toolState.tool,
    setTool: toolState.setTool,
    onStickyShortcut: createAtCenter,
  });

  // Story 9: create a text object at a screen point (Text tool click, or an
  // object click while the Text tool is active). The object's top-left is the
  // clicked point; editing starts immediately. One undo step to create.
  const createTextAtScreen = useCallback(
    (screenPoint: Point) => {
      if (!editable) return;
      const world = screenToWorld(cam.camera, screenPoint);
      undo.boundary();
      const id = createText(doc, world, clientIdRef.current);
      undo.boundary();
      if (id) {
        // The Text tool hands back to Select after creating (PRD text.tool_ui).
        toolState.setTool('select');
        sel.startEdit(id);
      }
    },
    [cam.camera, doc, editable, sel, toolState, undo],
  );

  // Object pointer-down: while the Text tool is active, a click on top of an
  // existing object creates new text at that point (PRD text tool behaviour).
  const handleObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      if (toolState.tool === 'text' || activeTool.tool === 'text') {
        createTextAtScreen({ x: e.clientX, y: e.clientY });
        return;
      }
      // Story 10/11: shape/connector/pen tools own the gesture (overlay handles it)
      if (
        activeTool.tool === 'shape' ||
        activeTool.tool === 'connector' ||
        activeTool.tool === 'pen'
      ) {
        return;
      }
      gesture.onObjectPointerDown(e, id);
    },
    [toolState.tool, activeTool.tool, createTextAtScreen, gesture],
  );

  // Story 11 (pen.select fall-through): a pointerdown inside a stroke's bbox
  // that missed its line is routed to the topmost object underneath. With
  // nothing underneath the event is left un-stopped so the viewport keeps
  // its normal pan/marquee/clear behaviour.
  const handleMissHit = useCallback(
    (e: PointerEvent, world: Point) => {
      const below = objectAtPoint(notes, world, cam.camera.zoom);
      if (below) {
        e.stopPropagation();
        gesture.onObjectPointerDown(e, below.id);
      }
    },
    [notes, cam.camera, gesture],
  );

  // Story 9: change a text object's size preset (TextToolbar) — the box is
  // remeasured after the change; one undo step.
  const handleTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!editable) return;
      undo.boundary();
      setTextSize(doc, id, size);
      remeasureTextObject(doc, id, measurerRef.current!);
      undo.boundary();
    },
    [doc, editable, undo],
  );

  const handleClearSelection = useCallback(() => {
    sel.clear();
  }, [sel]);

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    if (sel.ids.size > 0) {
      // Story 8: the whole deletion is one undo step.
      undo.boundary();
      deleteObjects(doc, [...sel.ids]);
      undo.boundary();
    }
  }, [doc, sel, editable, undo]);

  const handleColor = useCallback(
    (id: string, c: StickyColor) => {
      if (!editable) return;
      // Story 8: a colour change is one undo step.
      undo.boundary();
      setStickyColor(doc, id, c);
      undo.boundary();
    },
    [doc, editable, undo],
  );

  // Story 10: shape style changes (fill/stroke)
  const handleShapeFill = useCallback(
    (id: string, c: FillColor) => {
      if (!editable) return;
      undo.boundary();
      setShapeStyle(doc, id, { fill: c });
      undo.boundary();
    },
    [doc, editable, undo],
  );

  const handleShapeStroke = useCallback(
    (id: string, c: StrokeColor) => {
      if (!editable) return;
      undo.boundary();
      setShapeStyle(doc, id, { stroke: c });
      undo.boundary();
    },
    [doc, editable, undo],
  );

  // Render objects in a stable order (by id) so that changing an object's z
  // (e.g. bringToFront during a drag) only changes its z-index and never
  // reorders the DOM. Reordering a DOM node mid-drag would reset the active
  // pointer capture. Visual stacking is handled by each object's z-index.
  const orderedNotes = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Story 7: the selection bar sits above the selection's bounding box
  // (screen space), like the story-2 NoteToolbar did for a single note.
  // The host is positioned with translate(-50%, -100%), so (left, top) is the
  // bar's bottom-centre. When the box is at the top screen edge the bar would
  // render off-screen, so clamp it into the viewport (estimated bar size:
  // 44px tall, ~240px wide).
  const selectedNotes = notes.filter((n) => sel.ids.has(n.id));
  let selectionBarPos: { left: number; top: number } | null = null;
  if (selectedNotes.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    for (const o of selectedNotes) {
      const b = objectBounds(o);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
    }
    const tl = worldToScreen(cam.camera, { x: (minX + maxX) / 2, y: minY });
    const halfW = 120;
    const left = Math.min(
      Math.max(tl.x, halfW),
      Math.max(viewport.width - halfW, halfW),
    );
    const top = Math.max(tl.y - 8, 44 + 2);
    selectionBarPos = { left, top };
  }
  const showSelectionBar =
    sel.ids.size > 0 && sel.editingId === null && !gestureActive && !!selectionBarPos;

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0 }}
      onDragEnter={imageInsert.onDragEnter}
      onDragOver={imageInsert.onDragOver}
      onDragLeave={imageInsert.onDragLeave}
      onDrop={imageInsert.onDrop}
    >
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        textToolActive={toolState.tool === 'text'}
        penToolActive={activeTool.tool === 'pen'}
        onTextCreateAt={createTextAtScreen}
        onCreateStickyAt={createAtScreen}
        onClearSelection={handleClearSelection}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        onViewportEl={(el) => {
          viewportElRef.current = el;
        }}
      >
        {orderedNotes.map((note) => {
          const spec = getObjectType(note.type);
          if (!spec) return null; // unknown type: skip (forward compat)

          // Story 12: Image objects need special props
          if (note.type === 'image') {
            const img = note as import('../../shared/objects/image').ImageSnap;
            return (
              <ImageObject
                key={note.id}
                image={img}
                isUploader={img.uploaderId === clientIdRef.current}
                progress={imageInsert.progress.get(note.id)}
                canRetry={imageInsert.canRetry(note.id)}
                now={Date.now()}
                onRetry={() => imageInsert.retry(note.id)}
                onRemove={() => {
                  if (!editable) return;
                  undo.boundary();
                  deleteObjectsModel(doc, [note.id]);
                  undo.boundary();
                }}
              />
            );
          }

          const C = spec.Component;
          return (
            <C
              key={note.id}
              obj={note as ObjectSnapshot}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={sel.ids.has(note.id)}
              editing={sel.editingId === note.id}
              onObjectPointerDown={handleObjectPointerDown}
              onStartEdit={(id: string) => {
                if (editable) sel.startEdit(id);
              }}
              onEndEdit={(next) => {
                sel.endEdit();
                if (next === 'unselected') sel.clear();
              }}
              undo={undo}
              measurer={measurerRef.current ?? undefined}
              onMissHit={handleMissHit}
              camera={cam.camera}
            />
          );
        })}
        <SelectionOverlay
          ids={sel.ids}
          snapshot={notes}
          camera={cam.camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>
      {/* Story 10: Shape and Connector tool overlays */}
      {activeTool.tool === 'shape' && editable && (
        <ShapeTool
          kind={activeTool.shapeKind}
          camera={cam.camera}
          doc={doc}
          createdBy={clientIdRef.current}
          onCreated={(id) => {
            undo.boundary();
            activeTool.toolCreated(id);
            undo.boundary();
          }}
        />
      )}
      {activeTool.tool === 'connector' && editable && (
        <ConnectorTool
          camera={cam.camera}
          snapshot={notes}
          doc={doc}
          createdBy={clientIdRef.current}
          onCreated={(id) => {
            undo.boundary();
            activeTool.toolCreated(id);
            undo.boundary();
          }}
        />
      )}
      {/* Story 11: Pen tool overlay + options toolbar */}
      {activeTool.tool === 'pen' && editable && (
        <PenTool
          camera={cam.camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId={clientIdRef.current}
          wheel={cam.wheel}
          onCommitted={() => undo.boundary()}
        />
      )}
      {activeTool.tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      <Toolbar
        tool={toolState.tool}
        setTool={toolState.setTool}
        activeTool={activeTool.tool}
        setActiveTool={activeTool.setTool}
        shapeKind={activeTool.shapeKind}
        setShapeKind={activeTool.setShapeKind}
        onCreateSticky={createAtCenter}
        disabled={!editable}
        undo={undoControls}
        onImagePick={imageInsert.openPicker}
      />
      {showSelectionBar && selectionBarPos && (
        <div
          data-testid="selection-bar-host"
          style={{
            position: 'fixed',
            left: selectionBarPos.left,
            top: selectionBarPos.top,
            transform: 'translate(-50%, -100%)',
            zIndex: 30,
          }}
        >
          <SelectionBar
            ids={sel.ids}
            snapshot={notes}
            onDelete={handleDeleteSelection}
            onColor={handleColor}
            onTextSize={handleTextSize}
            onShapeFill={handleShapeFill}
            onShapeStroke={handleShapeStroke}
          />
        </div>
      )}
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <DropHighlight visible={imageInsert.dragActive} />
      <ToastContainer toasts={toasts} />
    </div>
  );
}

// Kept for API compatibility with story 2 (standard sticky size).
void STICKY_SIZE_WORLD;
