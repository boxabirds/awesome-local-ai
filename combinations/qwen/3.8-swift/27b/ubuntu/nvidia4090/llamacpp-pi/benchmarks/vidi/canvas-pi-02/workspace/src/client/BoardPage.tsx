// Board page (story 3 UI + story 5, share.check / share.share): verifies
// the board exists (GET /api/boards/:id with exponential-backoff retries)
// before rendering the board, shows a spinner while checking, a not-found
// view when the board is gone, and a Share button/panel for the link.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera } from './canvas/useCamera';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size,
} from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { useSelection } from './board/useSelection';
import { useBoardKeys } from './board/useBoardKeys';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool, type PenToolApi } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { useMarquee, MarqueeRect } from './board/useMarquee';
import { useTransformGesture } from './board/useTransformGesture';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { createUndo } from './board/undo';
import { useUndo } from './board/useUndo';
import { NOTE_TOOLBAR_GAP_PX } from './objects/NoteToolbar';
import { getObjectType } from './objects/registry';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
} from '../shared/board-model';
import { createText, setTextSize, textSnapshot } from '../shared/objects/text';
import { shapeSnapshot, setShapeStyle } from '../shared/objects/shape';
import { connectorSnapshot, setConnectorEndpoint, connectorResolved } from '../shared/objects/connector';
import { strokeSnapshot } from '../shared/objects/stroke';
import { imageSnapshot } from '../shared/objects/image';
import { nearestSide, sideAnchor } from '../shared/geometry/connector-geometry';
import { TEXT_FONT_FAMILY, type TextSize } from '../shared/config';
import { remeasureTextObject } from './objects/useTextBoxSync';
import { createCanvasMeasurer, type Measurer } from './objects/textLayout';
import { unionRects, type Rect } from '../shared/geometry';
import { connectorAtPoint, objectAtPoint } from './objects/hitTest';
import {
  STICKY_SIZE_WORLD,
  BOARD_CHECK_MAX_RETRIES,
  BOARD_CHECK_RETRY_BASE_MS,
  BOARD_CHECK_RETRY_MAX_DELAY_MS,
  IMAGE_UPLOAD_TICK_MS,
} from '../shared/config';
import { ToastStack, useToasts } from './board/Toast';
import { DropHighlight } from './board/DropHighlight';
import { useBoardImageDrop } from './board/useBoardImageDrop';
import { useImageInsert } from './images/useImageInsert';
import { canEdit } from './sync/connectBoard';
import { isValidBoardId } from '../shared/board-id';
import { checkBoard } from './api';
import { NotFound } from './NotFound';
import { ShareButton, SharePanel } from './Share';



/**
 * Board existence check (share.check): tries checkBoard up to
 * BOARD_CHECK_MAX_RETRIES times; a 404 (BoardNotFound) and any transient
 * error are retried with exponential backoff (base doubling, capped). A
 * storage hiccup must not make an existing board appear missing (TC-28).
 */
type ExistenceState = 'checking' | 'retrying' | 'exists' | 'not_found';
type Existence = ExistenceState;

function useBoardExistence(boardId: string): ExistenceState {
  const [state, setState] = useState<Existence>('checking');

  useEffect(() => {
    let cancelled = false;
    const attempt = async (n: number): Promise<void> => {
      try {
        await checkBoard(boardId);
        if (!cancelled) setState('exists');
        return;
      } catch (e) {
        // Both definite (404) and transient (unreachable) errors retry; only
        // exhaustion declares the board missing.
        void e;
      }
      if (n >= BOARD_CHECK_MAX_RETRIES) {
        if (!cancelled) setState('not_found');
        return;
      }
      if (!cancelled) setState('retrying');
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * 2 ** (n - 1),
        BOARD_CHECK_RETRY_MAX_DELAY_MS,
      );
      await new Promise((r) => window.setTimeout(r, delay));
      if (!cancelled) await attempt(n + 1);
    };
    void attempt(1);
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  return state;
}

function useViewportSize(ref: React.RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The board itself: the pre-story-5 App UI, now parameterised by id and
 *  only mounted once the existence check passes.
 *
 *  Story 7 (sel.*): selection, marquee, transform gestures, keyboard
 *  shortcuts and the selection bar/overlay live here; objects render through
 *  the type registry (sel.all_types). */
function Board({ boardId }: { boardId: string }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const camera = useCamera(viewport);
  const { doc, objects, connectionState, connectionRef } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const [dragging, setDragging] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const docRef = useRef(doc);
  docRef.current = doc;
  const connectionStateRef = useRef(connectionState);
  connectionStateRef.current = connectionState;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Story 4 (persist.client_status): the board is locked while the room
  // reports a load failure; every edit path below checks this flag.
  const editable = canEdit(connectionState);

  // Story 6 (creator identity) is out of scope: createdBy is a session-
  // unique client id (see NOTES.md).
  const clientIdRef = useRef('');
  if (clientIdRef.current === '') clientIdRef.current = crypto.randomUUID();

  // Story 12 (image.toasts): transient notices for rejections/network/rate.
  const { toasts, showToast } = useToasts();

  // Story 12 (image.drop/paste/picker/uploads): image insertion. Uploads
  // complete via UPLOAD_ORIGIN (not an undo step); a drop's placeholders
  // are ONE LOCAL_ORIGIN transaction (one undo step, story 8).
  const imageInsert = useImageInsert({
    boardId,
    getDoc: () => docRef.current,
    isConnected: () => connectionStateRef.current === 'connected' || connectionStateRef.current === 'confirmed',
    clientId: clientIdRef.current,
    onToast: showToast,
    getCamera: () => cameraRef.current.camera,
    getViewportSize: () => viewport,
  });
  const imageDrop = useBoardImageDrop({
    onDrop: (files, point) => imageInsertRef.current.insertFiles(files, 'drop', point),
    onPaste: (files) => imageInsertRef.current.insertFiles(files, 'paste'),
    getRootEl: () => rootRef.current,
  });
  const imageInsertRef = useRef(imageInsert);
  imageInsertRef.current = imageInsert;

  // Story 12 (image.unfinished): while any image is uploading, tick the
  // render clock so the derived `unfinished` state appears on its own.
  const [imageNow, setImageNow] = useState<number>(() => Date.now());
  useEffect(() => {
    let uploading = false;
    for (const o of objects) {
      if (o.type !== 'image') continue;
      const s = imageSnapshot(doc, o.id);
      if (s !== null && s.status === 'uploading') {
        uploading = true;
        break;
      }
    }
    if (!uploading) return;
    setImageNow(Date.now());
    const t = setInterval(() => setImageNow(Date.now()), IMAGE_UPLOAD_TICK_MS);
    return () => clearInterval(t);
  }, [doc, objects]);

  // Story 12 (image.unavailable): the uploader's Retry / Remove actions on
  // a failed upload.
  const retryImage = useCallback((id: string): void => {
    imageInsertRef.current.retryImage(id);
  }, []);
  const removeImage = useCallback((id: string): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    // Removing a failed placeholder is one undo step (undo.steps).
    undoRef.current?.boundary();
    deleteObjects(docRef.current, [id]);
    undoRef.current?.boundary();
    selectionRef.current.clear();
  }, []);

  // Story 10 (tools.shortcuts): the active tool (select/text/shape/
  // connector), the Shape tool's kind, and the V/T/S/L/Escape shortcuts.
  // One-shot tools: creating an object reverts to Select (tools.one_shot).
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    isEditing: () => selectionRef.current.editingId !== null,
    select: (id) => selectionRef.current.selectCreated(id),
    // Story 12 (image.picker): 'i' opens the picker (an action, not a tool).
    onImageShortcut: () => imageInsertRef.current.openPicker(),
  });

  // Story 11 (pen.options): session-only pen colour/thickness; the choices
  // affect only SUBSEQUENT strokes (existing strokes keep their own).
  const penOptions = usePenOptions();
  const penToolRef = useRef<PenToolApi>(null);

  // One shared canvas measurer for text layout (text.layout).
  const measurerRef = useRef<Measurer | null>(null);
  if (measurerRef.current === null) measurerRef.current = createCanvasMeasurer(TEXT_FONT_FAMILY);

  // Story 8 (undo.history): one personal undo controller per board doc,
  // tracking LOCAL_ORIGIN only. History is session-only: destroyed on
  // unmount, a fresh controller after reload starts empty (undo.session_only).
  const undoRef = useRef<ReturnType<typeof createUndo> | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undoController = undoRef.current;
  useEffect(() => {
    return () => undoController.destroy();
  }, [undoController]);
  const undoApi = useUndo(undoController, editable);

  // Gesture event counters (test hooks) and undo boundaries (story 8):
  // a complete drag/resize is ONE undo step — boundary() at gesture start
  // and end (incl. pointercancel) merges all rAF-frame writes inside it
  // (undo.steps, undo.boundaries).
  const gestureEventsRef = useRef({ start: 0, end: 0 });

  // Generic transform gesture: group move + bounding-box resize (story 7,
  // sel.transform). Owns exactly one pointer at a time.
  const gesture = useTransformGesture({
    doc,
    camera: camera.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => {
      gestureEventsRef.current.start += 1;
      undoRef.current?.boundary();
    },
    onGestureEnd: () => {
      gestureEventsRef.current.end += 1;
      undoRef.current?.boundary();
    },
    onDraggingChange: setDragging,
    // Story 9: a single text's fixed width changed (e/w handle) → re-
    // measure its box inside the gesture's capture window.
    onTextWidthChanged: (id) => {
      remeasureTextObject(docRef.current, id, measurerRef.current!);
    },
  });

  // Story 9 (text.box_sync, TC-25): my own undo/redo reverts my text
  // changes, and my stored box is part of those steps — re-measure the
  // local text objects after every history change so text and box revert
  // together in one visible step. A no-op when a box is already in sync;
  // remote changes never trigger a re-measure (text.box_sync).
  useEffect(() => {
    return undoController.onChange(() => {
      const d = docRef.current;
      for (const o of d.getMap('objects').values()) {
        const rec = o as Y.Map<unknown>;
        if (rec.get('type') === 'text' && typeof rec.get('id') === 'string') {
          remeasureTextObject(d, rec.get('id') as string, measurerRef.current!);
        }
      }
    });
  }, [undoController]);

  // Shift+drag marquee on empty space (story 7, sel.marquee_ui).
  const marquee = useMarquee(camera.camera, objects, (ids) => selection.setMany(ids, true));

  useEffect(() => {
    installTestHooks(
      () => cameraRef.current,
      () => docRef.current,
      () => connectionStateRef.current,
      () => connectionRef.current,
      () => [...selectionRef.current.ids],
      () => gestureEventsRef.current,
      () => clientIdRef.current,
    );
  }, []);

  const createStickyAtScreen = (p: Point): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    const world = screenToWorld(cameraRef.current.camera, p);
    // One note creation is one undo step (boundary before and after;
    // the editor's mount boundary then separates typing, undo.steps).
    undoRef.current?.boundary();
    const id = createSticky(doc, world);
    undoRef.current?.boundary();
    if (id !== '') selectionRef.current.startEdit(id);
  };

  const createStickyAtCenter = (): void => {
    createStickyAtScreen({ x: viewport.width / 2, y: viewport.height / 2 });
  };

  // Story 9 (text.create): a Text-tool click creates a size-M auto-width
  // text object with its top-left at the clicked point (world), starts
  // editing it and reverts the tool to Select. One creation is one undo
  // step (undo.steps).
  const createTextAtScreen = (p: Point): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    const world = screenToWorld(cameraRef.current.camera, p);
    undoRef.current?.boundary();
    const id = createText(docRef.current, world, clientIdRef.current);
    undoRef.current?.boundary();
    setTool('select'); // the tool is one-shot (text.tool)
    if (id !== null) selectionRef.current.startEdit(id);
  };

  // Story 9 (text.size): one size change (+ box re-measure) is one undo
  // step; x/y stay put.
  const changeTextSize = (id: string, size: TextSize): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    undoRef.current?.boundary();
    setTextSize(docRef.current, id, size);
    remeasureTextObject(docRef.current, id, measurerRef.current!);
    undoRef.current?.boundary();
  };

  // Story 10 (shape.style): one fill/stroke change is one undo step.
  const changeShapeStyle = (id: string, style: { fill?: import('../shared/config').FillColor; stroke?: import('../shared/config').StrokeColor }): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    undoRef.current?.boundary();
    setShapeStyle(docRef.current, id, style);
    undoRef.current?.boundary();
  };

  // Story 10 (conn.reattach): a connector end handle released at a client
  // point — convert to world, hit-test (excluding the other end's target),
  // attach to the hit object's nearest side or make a free endpoint.
  const onConnectorReattachEnd = (id: string, end: 'from' | 'to', clientPoint: Point): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    const vpEl = rootRef.current?.querySelector<HTMLDivElement>('[data-testid="board-viewport"]');
    if (vpEl === null || vpEl === undefined) return;
    const rect = vpEl.getBoundingClientRect();
    const world = screenToWorld(cameraRef.current.camera, { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top });
    const d = docRef.current;
    // Exclude the object the OTHER end is attached to (no degenerate loop).
    const snap = connectorSnapshot(d, id);
    const otherEnd = snap === null ? null : end === 'to' ? snap.from : snap.to;
    const excludeId = otherEnd !== null && otherEnd.kind === 'attached' ? otherEnd.objectId : null;
    const hit = objectAtPoint(d, objects, world, cameraRef.current.camera.zoom);
    const line = connectorResolved(d, id);
    undoRef.current?.boundary();
    let ok: boolean;
    if (hit !== undefined && hit.id !== excludeId) {
      const r = objectBounds(hit);
      const anchorFrom = line !== null ? (end === 'to' ? line.from : line.to) : world;
      ok = setConnectorEndpoint(d, id, end, {
        kind: 'attached',
        objectId: hit.id,
        fallback: sideAnchor(r, nearestSide(r, anchorFrom)),
      });
    } else {
      ok = setConnectorEndpoint(d, id, end, { kind: 'free', x: world.x, y: world.y });
    }
    undoRef.current?.boundary();
    if (ok) selectionRef.current.click(id);
  };

  // Story 10: live world rects of the non-connector objects (connector
  // endpoint resolution for rendering, conn.follow).
  const rectsMap: Map<string, Rect> = new Map();
  for (const o of objects) {
    if (o.type !== 'connector') rectsMap.set(o.id, objectBounds(o));
  }

  // Board keyboard shortcuts (story 7, sel.keyboard + story 8 undo.shortcuts
  // + story 2 N): Ctrl+A, Escape, arrows, Shift+arrows, Delete/Backspace,
  // Enter, Ctrl/Cmd+Z etc. undo/redo, and N (sticky at view centre).
  // (V/T/S/L/Escape tool switching lives in useActiveTool, story 10.)
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
    onCreateStickyCenter: createStickyAtCenter,
  });

  const deleteSelection = useCallback((): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    const ids = [...selectionRef.current.ids];
    if (ids.length === 0) return;
    // One delete (of any number of objects) is one undo step (undo.steps).
    undoRef.current?.boundary();
    deleteObjects(docRef.current, ids);
    undoRef.current?.boundary();
    selectionRef.current.clear();
  }, []);

  // Selection bar anchor: above the selection's bounding box (screen space).
  const selectedObjects = objects.filter((o) => selection.ids.has(o.id));
  const selectedBox = unionRects(selectedObjects.map(objectBounds));
  const barAnchor =
    selectedObjects.length > 0 && selectedBox !== null && !dragging && selection.editingId === null
      ? worldToScreen(camera.camera, { x: selectedBox.x, y: selectedBox.y })
      : null;

  // Viewport culling (story 4, persist.large_board): only mount objects that
  // intersect the visible world rect (with one note-width of margin).
  const viewTopLeft = screenToWorld(camera.camera, { x: 0, y: 0 });
  const viewBottomRight = screenToWorld(camera.camera, {
    x: viewport.width,
    y: viewport.height,
  });
  const margin = STICKY_SIZE_WORLD;
  const visibleObjects = objects.filter((o) => {
    if (selection.ids.has(o.id) || selection.editingId === o.id) return true;
    const b = objectBounds(o);
    return (
      b.x + b.width > viewTopLeft.x - margin &&
      b.x < viewBottomRight.x + margin &&
      b.y + b.height > viewTopLeft.y - margin &&
      b.y < viewBottomRight.y + margin
    );
  });

  return (
    <div className="board-root" ref={rootRef} {...imageDrop.handlers}>
      <div className="board-header">
        <ConnectionStatus state={connectionState} />
        <ShareButton onOpen={() => setShareOpen(true)} />
      </div>
      {shareOpen && <SharePanel boardId={boardId} onClose={() => setShareOpen(false)} />}
      <BoardViewport
        camera={camera}
        textToolActive={tool === 'text'}
        onTextClick={createTextAtScreen}
        penToolActive={tool === 'pen' && editable}
        onPenPointerDown={(e) => penToolRef.current?.pointerDown(e)}
        onPenPointerMove={(e) => penToolRef.current?.pointerMove(e)}
        onPenPointerUp={(e) => penToolRef.current?.pointerUp(e)}
        onPenPointerCancel={(e) => penToolRef.current?.pointerCancel(e)}
        onPenPointerLeave={() => penToolRef.current?.pointerLeave()}
        onDblClickEmpty={(p) => createStickyAtScreen(p)}
        onEmptyClick={(p) => {
          // Story 11: while the Pen is active a click drew a stroke/dot —
          // never deselect.
          if (tool === 'pen') return;
          if (selection.editingId !== null) {
            selection.endEdit();
            return;
          }
          // Story 10 (board.click_arrow): a click on an arrow (line within
          // the screen tolerance) selects it.
          const world = screenToWorld(cameraRef.current.camera, p);
          const hit = connectorAtPoint(docRef.current, objects, world, cameraRef.current.camera.zoom);
          if (hit !== undefined) selectionRef.current.click(hit.id);
          else selectionRef.current.clear();
        }}
        marquee={marquee}
      >
        <MarqueeRect rect={marquee.rect} camera={camera.camera} />
        {/* Story 12 (image.drop): the drop highlight, above the objects. */}
        <DropHighlight visible={imageDrop.dragging} />
        {visibleObjects.map((o) => {
          const spec = getObjectType(o.type);
          if (spec === undefined) return null; // unknown type: never rendered (D3)
          const Component = spec.Component;
          return (
            <Component
              key={o.id}
              obj={o}
              doc={doc}
              zoom={camera.camera.zoom}
              selected={selection.ids.has(o.id)}
              editing={selection.editingId === o.id}
              locked={!editable}
              dragging={dragging}
              // Story 11: while the Pen is active, drags on objects are the
              // pen's (pen.draw: strokes draw OVER objects).
              onPointerDown={tool === 'pen' ? () => {} : gesture.onObjectPointerDown}
              onSelect={selection.click}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              onClearSelection={selection.clear}
              undo={undoController}
              note={o.type === 'text' ? textSnapshot(doc, o.id) ?? undefined : undefined}
              shape={o.type === 'shape' ? shapeSnapshot(doc, o.id) ?? undefined : undefined}
              connector={o.type === 'connector' ? connectorSnapshot(doc, o.id) ?? undefined : undefined}
              stroke={o.type === 'stroke' ? strokeSnapshot(doc, o.id) ?? undefined : undefined}
              image={o.type === 'image' ? imageSnapshot(doc, o.id) ?? undefined : undefined}
              imageNow={o.type === 'image' ? imageNow : undefined}
              imageIsUploader={
                o.type === 'image'
                  ? imageSnapshot(doc, o.id)?.uploaderId === clientIdRef.current
                  : undefined
              }
              imageCanRetry={
                o.type === 'image'
                  ? editable && (connectionState === 'connected' || connectionState === 'confirmed')
                  : undefined
              }
              onImageRetry={o.type === 'image' ? retryImage : undefined}
              onImageRemove={o.type === 'image' ? removeImage : undefined}
              rects={rectsMap}
              onReattachEnd={onConnectorReattachEnd}
            />
          );
        })}
      </BoardViewport>
      {/* Story 10: the Shape / Connector tools (screen-space overlays that
          capture the pointer while their tool is active). */}
      {tool === 'shape' && (
        <ShapeTool
          kind={shapeKind}
          camera={camera.camera}
          doc={doc}
          createdBy={clientIdRef.current}
          onBoundary={() => undoRef.current?.boundary()}
          onCreated={(id) => {
            undoRef.current?.boundary();
            toolCreated(id);
          }}
        />
      )}
      {tool === 'connector' && (
        <ConnectorTool
          camera={camera.camera}
          snapshot={objects}
          doc={doc}
          createdBy={clientIdRef.current}
          onBoundary={() => undoRef.current?.boundary()}
          onCreated={(id) => {
            undoRef.current?.boundary();
            toolCreated(id);
          }}
        />
      )}
      {/* Story 11: the Pen tool — screen-space preview overlay + round
          cursor; stays active after each stroke (pen.stay_active). */}
      {tool === 'pen' && editable && (
        <PenTool
          ref={penToolRef}
          camera={camera.camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId={clientIdRef.current}
          onBoundary={() => undoRef.current?.boundary()}
          onCreated={(id) => selectionRef.current.selectCreated(id)}
        />
      )}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {barAnchor !== null && (
        <div
          className="note-toolbar-anchor"
          data-testid="selection-bar-anchor"
          style={{
            position: 'fixed',
            left: barAnchor.x + (selectedBox!.width * camera.camera.zoom) / 2,
            top: barAnchor.y - NOTE_TOOLBAR_GAP_PX,
            transform: 'translate(-50%, -100%)',
            zIndex: 20,
          }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={objects}
            disabled={!editable}
            onDelete={deleteSelection}
            onColor={(id, color) => {
              if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
              // One colour change is one undo step (undo.steps).
              undoRef.current?.boundary();
              setStickyColor(doc, id, color);
              undoRef.current?.boundary();
            }}
            textSize={
              selectedObjects.length === 1 && selectedObjects[0].type === 'text'
                ? textSnapshot(doc, selectedObjects[0].id)?.size
                : undefined
            }
            onTextSize={changeTextSize}
            shapeStyle={
              selectedObjects.length === 1 && selectedObjects[0].type === 'shape'
                ? (() => {
                    const s = shapeSnapshot(doc, selectedObjects[0].id);
                    return s === null ? null : { fill: s.fill, stroke: s.stroke };
                  })()
                : null
            }
            onShapeStyle={changeShapeStyle}
          />
        </div>
      )}
      <Toolbar
        tool={tool}
        onTool={setTool}
        shapeKind={shapeKind}
        onShapeKind={setShapeKind}
        onCreateSticky={createStickyAtCenter}
        onAddImage={() => imageInsertRef.current.openPicker()}
        disabled={!editable}
        undo={undoApi}
      />
      {/* Story 12 (image.toasts): the transient toast stack. */}
      <ToastStack toasts={toasts} />
      {/* Story 12 (image.picker): the hidden file input. */}
      <input
        ref={imageInsert.fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={imageInsert.onFileInputChange}
        data-testid="image-file-input"
      />
      {/* Story 11 (pen.options): pen colour/thickness next to the toolbar
          while the Pen tool is active. */}
      {tool === 'pen' && editable && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={() => camera.reset()}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </div>
  );
}

/** Route handler for /b/:boardId. A malformed id is a definite not-found
 *  (share.not_found): the not-found view shows with no existence request. */
export function BoardPage({ boardId }: { boardId: string }): ReactElement {
  if (!isValidBoardId(boardId)) {
    return <NotFound />;
  }
  return <BoardPageChecked boardId={boardId} />;
}

function BoardPageChecked({ boardId }: { boardId: string }): ReactElement {
  const existence = useBoardExistence(boardId);

  if (existence === 'checking') {
    return (
      <div className="board-loading" data-testid="board-loading">
        <div className="board-loading-spinner" aria-hidden="true" />
        <p>Opening board…</p>
      </div>
    );
  }
  if (existence === 'retrying') {
    return (
      <div className="board-loading" data-testid="board-loading">
        <div className="board-loading-spinner" aria-hidden="true" />
        <p>Couldn't reach vidi6. Retrying…</p>
      </div>
    );
  }
  if (existence === 'not_found') {
    return <NotFound />;
  }
  return <Board boardId={boardId} />;
}
