/**
 * Board (story 1-7): canvas, objects (through the object registry),
 * multi-selection, toolbar, zoom, connection status and navigation hint
 * for one board. The board id is given by the page (story 5: `/b/:id`
 * routes carry it).
 *
 * Story 7 (sel.*): selection / transform-gesture / marquee / keyboard are
 * wired here; every object type renders through the registry, so future
 * object types get selection, move, resize and delete for free.
 * Selection and the text-editing flag are client state — they are never
 * written to the Y.Doc.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraContext, useCamera } from './canvas/useCamera';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { installVidi6TestHooks, updateVidi6ConnectionState } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  renderOrder,
  setStickyColor,
  type StickySnapshot,
} from '../shared/board-model';
import { createText, deleteIfEmpty, setTextSize } from '../shared/objects/text';
import { setShapeStyle } from '../shared/objects/shape';
import type { ShapeSnapshot } from '../shared/objects/shape';
import { CLIENT_ID } from './client-id';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  type ShapeFillColor,
  type ShapeKind,
  type ShapeStrokeColor,
  type StickyColor,
  type TextSize,
} from '../shared/config';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { createUndo } from './board/undo';
import { useUndo } from './board/useUndo';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool, usePenGesture } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { getObjectType, type GesturePointerEvent } from './objects/registry';
import { type ConnectionState } from './sync/connectBoard';

/**
 * The board is editable in every connection state except load_failed
 * (persist.client_status): while the board couldn't be loaded, edits would
 * be lost, so create/drag/edit/colour/delete are no-ops and the Sticky note
 * button is disabled. Exported for the component tests (TC-23) and reused by
 * the board to gate its editing handlers.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Board background colour (the dot grid is drawn on top). */
const BOARD_BACKGROUND = '#f8f8f6';
/** Origin marker (small crosshair at world 0,0): a stable e2e pixel target. */
const ORIGIN_MARKER_HALF_PX = 6;
const ORIGIN_MARKER_COLOR = '#8f8f86';

/**
 * Small crosshair at the board's starting point (world 0,0), rendered in
 * all builds so e2e tests have a stable pixel target.
 */
function OriginMarker(): JSX.Element {
  return (
    <div
      data-testid="origin-marker"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -ORIGIN_MARKER_HALF_PX,
        top: -ORIGIN_MARKER_HALF_PX,
        width: ORIGIN_MARKER_HALF_PX * 2,
        height: ORIGIN_MARKER_HALF_PX * 2,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: ORIGIN_MARKER_HALF_PX - 0.5,
          width: '100%',
          height: 1,
          background: ORIGIN_MARKER_COLOR,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: ORIGIN_MARKER_HALF_PX - 0.5,
          top: 0,
          width: 1,
          height: '100%',
          background: ORIGIN_MARKER_COLOR,
        }}
      />
    </div>
  );
}

interface BoardProps {
  boardId: string;
  /** Test-only: report the backing Y.Doc once it exists (component tests). */
  onDocReady?: (doc: Y.Doc) => void;
}

export function Board({ boardId, onDocReady }: BoardProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth || 1,
    height: window.innerHeight || 1,
  }));

  // Viewport size from a ResizeObserver (window resize never moves content:
  // the camera is anchored to the top-left and carries no size).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const update = (): void => {
      setViewport((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    // Fallback for environments without ResizeObserver (e.g. jsdom).
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const cameraController = useCamera(viewport);
  const { doc, objects, connectionState, dropSocket, resumeSocket } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);

  // --- undo / redo (story 8) -------------------------------------------------
  // One controller per board doc, created with the doc and destroyed on
  // board change / unmount: history is session-only (undo.session_only) and
  // holds only this tab's LOCAL_ORIGIN steps (undo.own).
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  const undoActions = useUndo(undo, editable);

  // Test-only: expose the doc for the component tests.
  if (onDocReady !== undefined) {
    onDocReady(doc);
  }

  // --- selection (story 7) --------------------------------------------------
  const selection = useSelection(objects);

  // --- tools (story 9/10, text.tool_ui / tools.active_tool) ------------------
  // Select is the default; the creation tools are armed via shortcuts or
  // the Toolbar. While the board is not editable (load_failed) an active
  // creation tool reverts to Select. V always reverts to Select (local UI).
  // (useActiveTool is called after the create callbacks it needs exist.)

  // --- text editing ----------------------------------------------------------
  // The editor reports 'unselected' when a press lands outside the object
  // (clearing the whole selection) and 'selected' for Escape (keeping it).
  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected'): void => {
      const endedId = selection.editingId;
      // Story 9 (text.empty_removed): a text object still empty when editing
      // ends is removed. No explicit boundary: the removal lands inside the
      // editor's open capture window (mount->unmount boundaries), so undoing
      // restores the object with whatever was typed.
      if (endedId !== null && deleteIfEmpty(doc, endedId)) {
        selection.clear();
        return;
      }
      if (next === 'unselected') {
        selection.clear();
      } else {
        selection.endEdit();
      }
    },
    [doc, selection],
  );

  const handleEdit = useCallback(
    (id: string): void => {
      if (!editable) {
        return; // load_failed: editing is locked out
      }
      selection.click(id);
      selection.startEdit(id);
    },
    [editable, selection],
  );

  // --- transform gesture (story 7) -------------------------------------------
  const gesture = useTransformGesture({
    doc,
    camera: cameraController.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // Every drag (z-order bump + move/resize frames) is one undo step
    // (undo.boundaries): boundary before the first change and at the end
    // (pointerup and pointercancel alike — the hook fires once per
    // activated gesture).
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });

  // --- marquee (story 7) -------------------------------------------------------
  const marquee = useMarquee(cameraController.camera, objects, (ids) => {
    if (ids.length > 0) {
      selection.setMany(ids, true);
    }
  });

  // Test-only hooks (no-ops and tree-shaken in production builds).
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  useEffect(() => {
    installVidi6TestHooks(
      cameraController.setCamera,
      () => objectsRef.current,
      dropSocket,
      resumeSocket,
    );
  }, [cameraController.setCamera, dropSocket, resumeSocket]);

  // Keep the test hook's live connection state current (no-op in production).
  useEffect(() => {
    updateVidi6ConnectionState(connectionState);
  }, [connectionState]);

  /** Create a sticky note centred on a viewport-local point and start editing it. */
  const createAt = useCallback(
    (p: Point): void => {
      if (!editable) {
        return; // load_failed: editing is locked out (persist.client_status)
      }
      // One undo step per create (undo.boundaries); the editor's own mount
      // boundary keeps later typing out of the create step.
      undo.boundary();
      const id = createSticky(doc, screenToWorld(cameraController.camera, p));
      undo.boundary();
      if (id !== '') {
        // Select + start editing the new note immediately.
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [doc, cameraController.camera, selection, editable, undo],
  );

  const createAtCentre = useCallback((): void => {
    createAt({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAt, viewport]);

  const activeTool = useActiveTool({
    canEdit: editable,
    selectObject: (id: string) => selection.click(id),
    onCreateSticky: createAtCentre,
  });
  const { tool, setTool, shapeKind, setShapeKind, toolCreated } = activeTool;

  // --- pen (story 11, pen.tool) ---------------------------------------------
  // Session-only options (colour/thickness) plus the in-flight stroke.
  // The gesture is owned here and routed through the BoardViewport: while
  // the Pen tool is active, pointer drags (including over objects, which
  // are inert) draw a stroke and never pan. The preview is a local overlay
  // that is never written to the document, so nobody else sees an
  // in-progress stroke (pen.share); the tool stays active after each
  // commit (pen.stay_active).
  const penOptions = usePenOptions();
  const penGesture = usePenGesture({
    active: tool === 'pen' && editable,
    camera: cameraController.camera,
    color: penOptions.color,
    thickness: penOptions.thickness,
    doc,
    identityId: CLIENT_ID,
    onBoundary: undo.boundary,
  });

  /**
   * Story 9 (text.tool_ui): create a free text object at a viewport-local
   * point, select it, start editing it, and revert to the Select tool.
   */
  const createTextAt = useCallback(
    (p: Point): void => {
      if (!editable) {
        return; // load_failed: editing is locked out
      }
      // One undo step per create (undo.boundaries); the editor's own mount
      // boundary keeps later typing out of the create step.
      undo.boundary();
      const id = createText(doc, screenToWorld(cameraController.camera, p), CLIENT_ID);
      undo.boundary();
      if (id !== null) {
        // Select + start editing the new text immediately.
        selection.click(id);
        selection.startEdit(id);
      }
      // The tool always reverts to Select after creating a text
      // (text.tool_ui), so consecutive clicks each create a new text.
      setTool('select');
    },
    [doc, cameraController.camera, selection, editable, undo, setTool],
  );

  /**
   * Story 9 (text.object): change the size preset of the single selected
   * text object. The box re-measures automatically (useTextBoxSync): the
   * font size changes, the position never does.
   */
  const changeTextSize = useCallback(
    (s: TextSize): void => {
      if (!editable) {
        return;
      }
      const id = selection.ids.values().next().value;
      if (id === undefined) {
        return;
      }
      const obj = objects.find((o) => o.id === id);
      if (obj === undefined || obj.type !== 'text') {
        return; // only a single selected text shows the TextToolbar
      }
      // One undo step per size change; the re-measure (same transaction
      // batch via the box sync) lands inside this window.
      undo.boundary();
      setTextSize(doc, id, s);
      undo.boundary();
    },
    [doc, objects, selection, editable, undo],
  );

  // --- keyboard commands (story 7 + 8) ---------------------------------------
  // (Tool shortcuts — V, T, S, L, N, Escape — are owned by useActiveTool.)
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo,
  });

  /**
   * Story 10 (connector.select): a Select-tool press on empty space hit-
   * tests the connector lines (topmost first, registry tolerance);
   * returning true consumed the press (selected, no pan/marquee).
   */
  /**
   * Story 10 (connector.select) + story 11 (pen.select): a Select-tool
   * press on empty space hit-tests the connector and stroke lines
   * (topmost first, registry tolerances); returning true consumed the
   * press (selected, no pan/marquee).
   */
  const onEmptyPointerDown = useCallback(
    (e: GesturePointerEvent, p: Point): boolean => {
      const world = screenToWorld(cameraController.camera, p);
      const zoom = cameraController.camera.zoom;
      const connectorSpec = getObjectType('connector');
      const strokeSpec = getObjectType('stroke');
      const candidates = objects
        .filter((o) => o.type === 'connector' || o.type === 'stroke')
        .sort((a, b) => b.z - a.z);
      for (const c of candidates) {
        const spec = c.type === 'connector' ? connectorSpec : strokeSpec;
        if (spec !== undefined && spec.hitTest(c, world, zoom)) {
          gesture.onObjectPointerDown(e, c.id);
          return true;
        }
      }
      return false;
    },
    [cameraController.camera, objects, gesture],
  );

  const deleteSelection = useCallback((): void => {
    if (!editable) {
      return; // load_failed: editing is locked out
    }
    const ids = [...selection.ids];
    if (ids.length === 0) {
      return;
    }
    // One undo step per delete (undo.boundaries).
    undo.boundary();
    if (deleteObjects(doc, ids) > 0) {
      selection.clear();
      undo.boundary();
    }
  }, [doc, selection, editable, undo]);

  const recolorSelection = useCallback(
    (c: StickyColor): void => {
      if (!editable) {
        return; // load_failed: editing is locked out
      }
      const id = selection.ids.values().next().value;
      if (id !== undefined && getStickyText(doc, id) !== undefined) {
        // One undo step per recolour (undo.boundaries).
        undo.boundary();
        setStickyColor(doc, id, c);
        undo.boundary();
      }
    },
    [doc, selection, editable, undo],
  );

  /**
   * Story 10 (shape.style): change the fill and/or outline of the single
   * selected shape. One undo step per swatch click.
   */
  const changeShapeStyle = useCallback(
    (s: { fill?: ShapeFillColor; stroke?: ShapeStrokeColor }): void => {
      if (!editable) {
        return;
      }
      const id = selection.ids.values().next().value;
      if (id === undefined) {
        return;
      }
      const obj = objects.find((o) => o.id === id);
      if (obj === undefined || obj.type !== 'shape') {
        return; // only a single selected shape shows the ShapeToolbar
      }
      undo.boundary();
      setShapeStyle(doc, id, s);
      undo.boundary();
    },
    [doc, objects, selection, editable, undo],
  );

  const ordered = renderOrder(objects);

  // The selection chrome (outline, handles, bar) is hidden during a
  // transform gesture and while a note is being edited (sel.interaction).
  const chromeVisible = selection.editingId === null;

  const selectedSticky =
    selection.ids.size === 1
      ? (objects.find(
          (o) => selection.ids.has(o.id) && o.type === 'sticky',
        ) as StickySnapshot | undefined)
      : undefined;

  // Story 10 (shape.style): exactly one selected shape shows the Shape
  // toolbar (fill + outline swatches) above it.
  const selectedShape =
    selection.ids.size === 1
      ? (objects.find(
          (o) => selection.ids.has(o.id) && o.type === 'shape',
        ) as ShapeSnapshot | undefined)
      : undefined;

  return (
    <CameraContext.Provider value={cameraController}>
      <div
        ref={rootRef}
        data-testid="app-root"
        style={{ position: 'fixed', inset: 0, background: BOARD_BACKGROUND }}
      >
        <BoardViewport
          onDoubleClickEmpty={
            editable && tool === 'select' ? createAt : undefined
          }
          onEmptyClick={selection.clear}
          onEmptyPointerDown={editable ? onEmptyPointerDown : undefined}
          pen={tool === 'pen' && editable ? penGesture.gesture : undefined}
          tool={tool}
          onTextToolClick={editable ? createTextAt : undefined}
          onMarqueeBegin={(p) => marquee.begin(p)}
          onMarqueeMove={(p) => marquee.move(p)}
          onMarqueeEnd={marquee.end}
          onMarqueeCancel={marquee.cancel}
          overlay={
            <>
              {chromeVisible && (
                <SelectionOverlay
                  ids={selection.ids}
                  snapshot={objects}
                  camera={cameraController.camera}
                  onHandlePointerDown={gesture.onHandlePointerDown}
                />
              )}
              <MarqueeRect rect={marquee.rect} camera={cameraController.camera} />
              {chromeVisible && selection.ids.size >= 1 && (
                <SelectionBar
                  ids={selection.ids}
                  snapshot={objects}
                  camera={cameraController.camera}
                  onDelete={deleteSelection}
                  onTextSize={changeTextSize}
                  disabled={!editable}
                />
              )}
            </>
          }
        >
          <OriginMarker />
          {/* Stable DOM order (renderOrder): a DOM move would release pointer
              capture and kill an in-flight drag; stacking is CSS z-index. */}
          {ordered.map((obj) => {
            const spec = getObjectType(obj.type);
            if (spec === undefined) {
              return null; // unknown type: ignored (forward compatibility)
            }
            const { Component } = spec;
            return (
              <Component
                key={obj.id}
                doc={doc}
                obj={obj}
                selected={selection.ids.has(obj.id)}
                editingId={selection.editingId}
                onPointerDown={gesture.onObjectPointerDown}
                onEdit={handleEdit}
                onEndEdit={handleEndEdit}
                onTextBoundary={undo.boundary}
                onTextUndo={undo.undo}
                onBoundary={undo.boundary}
                inert={tool !== 'select'}
                camera={cameraController.camera}
                objects={objects}
              />
            );
          })}
        </BoardViewport>
        {tool === 'shape' && editable && (
          <ShapeTool
            doc={doc}
            kind={shapeKind}
            camera={cameraController.camera}
            onCreated={toolCreated}
            onBoundary={undo.boundary}
          />
        )}
        {tool === 'connector' && editable && (
          <ConnectorTool
            doc={doc}
            camera={cameraController.camera}
            snapshot={objects}
            onCreated={toolCreated}
            onBoundary={undo.boundary}
          />
        )}
        {tool === 'pen' && editable && (
          <PenTool
            camera={cameraController.camera}
            color={penOptions.color}
            thickness={penOptions.thickness}
            doc={doc}
            identityId={CLIENT_ID}
            preview={penGesture.preview}
            cursor={penGesture.cursor}
          />
        )}
        {tool === 'pen' && editable && (
          <PenToolbar
            color={penOptions.color}
            thickness={penOptions.thickness}
            onColor={penOptions.setColor}
            onThickness={penOptions.setThickness}
          />
        )}
        <Toolbar
          onCreateSticky={createAtCentre}
          tool={tool}
          onToolChange={setTool}
          shapeKind={shapeKind}
          onShapeKindChange={setShapeKind}
          disabled={!editable}
          undo={undoActions}
        />
        <ConnectionStatus state={connectionState} />
        {chromeVisible && selectedSticky !== undefined && (
          <div
            style={{
              position: 'fixed',
              left:
                worldToScreen(cameraController.camera, {
                  x: selectedSticky.x + (selectedSticky.width ?? STICKY_SIZE_WORLD) / 2,
                  y: selectedSticky.y,
                }).x,
              top:
                worldToScreen(cameraController.camera, {
                  x: selectedSticky.x,
                  y: selectedSticky.y,
                }).y - 10,
              transform: 'translate(-50%, -100%)',
              zIndex: 3000,
            }}
          >
            <NoteToolbar
              color={selectedSticky.color}
              disabled={!editable}
              onColor={recolorSelection}
              onDelete={deleteSelection}
            />
          </div>
        )}
        {chromeVisible && selectedShape !== undefined && (
          <div
            style={{
              position: 'fixed',
              left:
                worldToScreen(cameraController.camera, {
                  x: selectedShape.x + (selectedShape.width ?? SHAPE_DEFAULT_SIZE_WORLD) / 2,
                  y: selectedShape.y,
                }).x,
              top:
                worldToScreen(cameraController.camera, {
                  x: selectedShape.x,
                  y: selectedShape.y,
                }).y - 10,
              transform: 'translate(-50%, -100%)',
              zIndex: 3000,
            }}
          >
            <ShapeToolbar
              fill={selectedShape.fill}
              stroke={selectedShape.stroke}
              onFill={(fill) => changeShapeStyle({ fill })}
              onStroke={(stroke) => changeShapeStyle({ stroke })}
            />
          </div>
        )}
        <ZoomControls
          zoomPercent={zoomPercent(cameraController.camera)}
          canZoomIn={canZoomIn(cameraController.camera)}
          canZoomOut={canZoomOut(cameraController.camera)}
          onZoomIn={() => cameraController.zoomStep('in')}
          onZoomOut={() => cameraController.zoomStep('out')}
          onReset={cameraController.reset}
        />
        <NavigationHint visible={!cameraController.hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
