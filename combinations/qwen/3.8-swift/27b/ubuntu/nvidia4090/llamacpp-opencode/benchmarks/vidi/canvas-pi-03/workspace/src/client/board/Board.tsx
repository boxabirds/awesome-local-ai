/**
 * Story 1–4 board UI (extracted from App.tsx in story 5): viewport, camera,
 * notes, toolbars and connection badge. Story 5 mounts it from BoardPage once
 * the board's existence check succeeds; the `__vidi6` test hook (test build
 * only) stays here with the board.
 */
import { type JSX, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent, worldToScreen, screenToWorld } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useMarquee, MarqueeRect } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { SelectionOverlay, selectionBounds } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { Toolbar } from './Toolbar';
import { createUndo } from './undo';
import { useUndo } from './useUndo';
import { getObjectType, hitConnectorAt } from '../objects/registry';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { BoardContext } from './context';
import { seedCheckoutFlow as seedCheckoutFlowFixture } from '../../../tests/fixtures/checkout-flow';
import {
  getShapeKind,
  getShapeStyle,
  setShapeStyle,
  type ShapeKind,
} from 'src/shared/objects/shape';
import { createCanvasMeasurer, type Measurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  getTextSize,
} from 'src/shared/objects/text';
import { TEXT_FONT_FAMILY, type TextSize } from 'src/shared/config';
import {
  createSticky,
  setStickyColor,
  deleteObject,
  deleteObjects,
  getStickyText,
  type StickySnapshot,
} from 'src/shared/board-model';

export function Board({ boardId }: { boardId: string }): JSX.Element {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cam = useCamera(size);
  const { doc, notes, objects, connectionState, dropSocket, resumeSocket } = useBoardDoc(boardId);
  const sel = useSelection(objects);
  // A load-failed board is read-only (persist.client_status): every board-model
  // mutation is a no-op and the create button is disabled.
  const editable = canEdit(connectionState);
  const [dragging, setDragging] = useState(false);
  const gestureStartsRef = useRef(0);
  const gestureEndsRef = useRef(0);

  // Story 8: ONE per-user undo controller per board doc (key decision 5).
  // BoardPage remounts Board per board id (key={route.id}) and a reload
  // starts a fresh tab, so history is session-only (undo.session_only).
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => {
    return () => {
      undoController.destroy();
    };
  }, [undoController]);
  const undoState = useUndo(undoController, editable);

  // Story 10: the active board tool (Select / Text / Shape / Connector),
  // generalising story 9's useTool — reverts to Select on a locked board.
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    select: sel.select,
  });
  // Story 9: the canvas measurer shared by all text-box remeasures on this
  // tab (the probe is cached inside the measurer).
  const measurer = useMemo<Measurer>(() => createCanvasMeasurer(TEXT_FONT_FAMILY), []);
  // Story 9: this tab's identity for `createdBy` (a per-tab stable id; a
  // full identity story is out of scope).
  const identityId = useRef(crypto.randomUUID()).current;

  // Story 7: the generic transform gesture — group move (drag any selected
  // object), single-object drag, handle resize with aspect lock + size
  // limits. Works for every registered object type (sel.all_types).
  // Story 8: gesture start/end (including pointercancel) close undo capture
  // windows, so one drag is exactly one undo step (undo.boundaries).
  // Story 9: side-handle drag on a SINGLE text object → fixed width +
  // remeasure (text.fixed_width). One drag is one undo step via the
  // gesture start/end boundaries below.
  const handleTextWidthResize = useCallback(
    (id: string, width: number) => {
      setTextWidthFixed(doc, id, width);
      remeasureTextBox(doc, id, measurer);
    },
    [doc, measurer],
  );

  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    onTextWidthResize: editable ? handleTextWidthResize : undefined,
    onGestureStart: () => {
      gestureStartsRef.current += 1;
      undoController.boundary();
      setDragging(true);
    },
    onGestureEnd: () => {
      gestureEndsRef.current += 1;
      undoController.boundary();
      setDragging(false);
    },
  });

  // Story 7: Shift+drag marquee on empty space — selects everything inside,
  // unioned with the current selection (sel.marquee).
  const marquee = useMarquee(cam.camera, objects, (ids) => sel.setMany(ids, true));


  // Test hook: story 1 exposes setCamera; story 2 additionally exposes the
  // board doc so tests can drive the model directly (e.g. TC-37).
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      // seedNotes creates `count` varied notes via the real board-model so the
      // Yjs updates flow through the normal sync → store path (deterministic
      // e2e seeding without 25× UI interactions).
      // `start` offsets both ids and grid positions so several calls never
      // collide (story 8 TC-23 seeds one note per undo step).
      const seedNotes = (count: number, start = 0): string[] => {
        const colors: Array<'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet'> = [
          'yellow',
          'orange',
          'green',
          'blue',
          'pink',
          'violet',
        ];
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          const n = start + i;
          const id = createSticky(
            doc,
            { x: (n % 5) * 120, y: Math.floor(n / 5) * 120 },
            colors[n % colors.length],
            `seed-${n}`,
          );
          if (id) {
            getStickyText(doc, id)?.insert(0, `Note ${n}: the quick brown fox`);
            ids.push(id);
          }
        }
        return ids;
      };
      // Story 10: the checkout-flow fixture (tests/fixtures/checkout-flow.ts,
      // built with the real model calls) — 4 labelled shapes (rect, diamond,
      // ellipse, rect), 3 attached connectors and 1 free-ended connector.
      const seedCheckoutFlow = (): string[] => seedCheckoutFlowFixture(doc, identityId);

      (window as unknown as Record<string, unknown>).__vidi6 = {
        setCamera: cam.setCamera,
        doc,
        connectionState,
        dropSocket,
        resumeSocket,
        seedNotes,
        seedCheckoutFlow,
        // Story 7: gesture bookkeeping (undo boundaries, story 8) + toolbar hiding.
        gestureStarts: () => gestureStartsRef.current,
        gestureEnds: () => gestureEndsRef.current,
        dragging,
        // Story 8: the per-user undo controller (component/e2e tests).
        undo: undoController,
      };
    }
  }, [cam.setCamera, doc, connectionState, dropSocket, resumeSocket, dragging, undoController, identityId]);

  // Double-click on empty board space: create a note centred on the point,
  // select it and start editing (sticky.create_dblclick). No-op when locked.
  const handleCreateStickyAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) return;
      // Story 8: one note creation is exactly one undo step.
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) sel.startEdit(id);
    },
    [doc, sel, editable, undoController],
  );

  // Toolbar button: create a note at the centre of the visible board area
  // (sticky.create_button) — works no matter where the board is panned. No-op
  // when locked.
  const handleCreateStickyCentred = useCallback(() => {
    if (!editable) return;
    const centre = screenToWorld(cam.camera, {
      x: size.width / 2,
      y: size.height / 2,
    });
    // Story 8: one note creation is exactly one undo step.
    undoController.boundary();
    const id = createSticky(doc, centre);
    undoController.boundary();
    if (id) sel.startEdit(id);
  }, [cam.camera, size, doc, sel, editable, undoController]);

  // Story 7: Ctrl+A / Escape / arrows / Delete / Enter (sel.keyboard).
  // Story 8: + Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y undo and redo.
  // Story 9: + V (Select tool), T (Text tool), N (sticky at centre),
  // Escape (Select tool + clear selection). (Called after the create
  // callbacks so N can reuse the centre-creation handler.)
  useBoardKeys({
    doc,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
    tool,
    setTool,
    onCreateStickyCentred: handleCreateStickyCentred,
  });

  // Story 9: Text tool click (empty space OR on top of an object) → create a
  // text object at the world point, switch back to Select, select it and
  // start editing (text.tool_ui). No-op when locked.
  const handleCreateTextAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) return;
      // Story 8: one text creation is exactly one undo step (the edit session
      // opens its own boundary in the editor).
      undoController.boundary();
      const id = createText(doc, world, identityId);
      undoController.boundary();
      setTool('select');
      if (id) sel.startEdit(id);
    },
    [doc, sel, editable, undoController, identityId, setTool],
  );

  // Story 9: while the Text tool is active, presses on EXISTING objects
  // create text on top at that point instead of selecting/dragging the
  // object (text.tool_ui). The viewport is fixed inset-0, so client
  // coordinates are screen coordinates relative to its origin.
  const handleTextToolPress = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      // Cancel the default focus too: a press on a focusable object (sticky,
      // text) would focus it, and its onFocus→onSelect would run after the
      // re-render and clear the just-started text editing (real browsers only
      // — jsdom never focuses on pointerdown).
      e.preventDefault();
      handleCreateTextAt(screenToWorld(cam.camera, { x: e.clientX, y: e.clientY }));
    },
    [cam.camera, handleCreateTextAt],
  );

  // Story 10 (connector.select): an empty-space click first hit-tests the
  // connectors — a click within CONNECTOR_HIT_TOLERANCE_PX of an arrow
  // selects it even though the pointer landed on the board background (the
  // SVG's wide hit stroke covers the same case in real browsers). Shapes and
  // stickies are NOT re-hit-tested here: in real browsers a click on one hits
  // its own DOM, so only the (jsdom-invisible) connector strokes need the
  // board-level test. Other empty clicks clear the selection (story 2).
  const handleEmptyClick = useCallback(
    (world: { x: number; y: number }) => {
      const id = hitConnectorAt(doc, world, cam.camera.zoom);
      if (id) sel.click(id);
      else sel.clear();
    },
    [doc, cam.camera, sel],
  );

  // Story 7: a group delete removes every selected object at once and clears
  // the selection (sel.delete_multi). No-op when the board is locked.
  // Story 8: the whole group delete is exactly one undo step.
  const handleDeleteSelection = useCallback(() => {
    if (!editable || sel.ids.size === 0) return;
    undoController.boundary();
    deleteObjects(doc, [...sel.ids]);
    undoController.boundary();
    sel.clear();
  }, [doc, editable, sel, undoController]);

  // The single selected sticky note (for the story 2 note toolbar — shown
  // only when EXACTLY one object is selected; with 2+ the selection bar
  // appears instead, sel.multibar). Hidden while a gesture is in progress.
  // The single selected sticky note (from `notes`: full StickySnapshot with
  // color/text). Only sticky notes have the note toolbar; other types do not.
  const singleSticky: StickySnapshot | undefined =
    sel.ids.size === 1 ? notes.find((n) => sel.ids.has(n.id)) : undefined;
  const showNoteToolbar = singleSticky !== undefined && sel.editingId === null && !dragging;

  // Story 9: the single selected TEXT object (text toolbar: sizes + delete).
  // The live size comes from the doc (the generic snapshot has no `size`).
  const singleTextId: string | undefined =
    sel.ids.size === 1
      ? (objects.find((o) => sel.ids.has(o.id) && o.type === 'text')?.id ?? undefined)
      : undefined;
  const singleTextSize: TextSize | undefined =
    singleTextId !== undefined ? getTextSize(doc, singleTextId) : undefined;
  const showTextToolbar =
    singleTextId !== undefined && sel.editingId === null && !dragging;

  // Story 10: exactly one selected SHAPE → the shape colour toolbar
  // (shape.style), placed like the other floating bars.
  const singleShape: {
    id: string;
    kind: ShapeKind;
    style: { fill: import('src/shared/objects/shape').FillColor; stroke: import('src/shared/objects/shape').StrokeColor };
  } | undefined = (() => {
    if (sel.ids.size !== 1) return undefined;
    const obj = objects.find((o) => sel.ids.has(o.id) && o.type === 'shape');
    if (!obj) return undefined;
    const kind = getShapeKind(doc, obj.id);
    const style = getShapeStyle(doc, obj.id);
    if (!kind || !style) return undefined;
    return { id: obj.id, kind, style };
  })();
  const showShapeToolbar =
    singleShape !== undefined && sel.editingId === null && !dragging;

  // Floating-bar placement: above the selection's bounding box (screen space).
  const selBox = sel.ids.size > 0 ? selectionBounds(sel.ids, objects) : null;
  let barStyle: React.CSSProperties | undefined;
  if (selBox) {
    const centre = worldToScreen(cam.camera, {
      x: selBox.x + selBox.width / 2,
      y: selBox.y,
    });
    barStyle = {
      position: 'fixed',
      left: centre.x,
      top: centre.y - 10,
      transform: 'translate(-50%, -100%)',
      zIndex: 1001,
    };
  }

  // Story 10: the connector's board-level extras (camera, identity, and an
  // ends-changed callback — doc updates already re-render, so a no-op is
  // sufficient; kept for the contract).
  const onEndsChanged = useCallback(() => {}, []);
  const boardContext = useMemo(
    () => ({ camera: cam.camera, identity: identityId, onEndsChanged }),
    [cam.camera, identityId, onEndsChanged],
  );

  return (
    <BoardContext.Provider value={boardContext}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomStepIn={cam.zoomStepIn}
        zoomStepOut={cam.zoomStepOut}
        reset={cam.reset}
        setCamera={cam.setCamera}
        onCreateStickyAt={handleCreateStickyAt}
        onEmptyClick={handleEmptyClick}
        tool={tool}
        onCreateTextAt={handleCreateTextAt}
        marquee={{
          active: marquee.rect !== null,
          begin: marquee.begin,
          move: marquee.move,
          end: marquee.end,
          cancel: marquee.cancel,
        }}
      >
        {/* Story 7: the marquee rectangle renders in the world layer. */}
        <MarqueeRect rect={marquee.rect} />
        {/* Render in stable id order, NOT z order: objects are stacked via
            `z-index` (which is deterministic from the model's z), and
            reordering the DOM on a z change would detach the node mid-drag,
            releasing its pointer capture and killing the drag. */}
        {[...objects]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((o) => {
            // Every type renders through the registry (sel.all_types): the
            // generic selection/move/resize machinery applies to all of them.
            const spec = getObjectType(o.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={o.id}
                obj={o}
                doc={doc}
                zoom={cam.camera.zoom}
                selected={sel.ids.has(o.id)}
                editing={sel.editingId === o.id}
                editable={editable}
                onPointerDown={
                  tool === 'text' ? handleTextToolPress : gesture.onObjectPointerDown
                }
                onSelect={sel.click}
                onStartEdit={sel.startEdit}
                onEndEdit={sel.endEdit}
                undo={undoController}
              />
            );
          })}
      </BoardViewport>
      {/* Story 10: the Shape and Connector tool layers capture every pointer
          while active (a drag starting over an object creates, it never
          moves that object — TC-28). */}
      {tool === 'shape' && editable && (
        <ShapeTool
          kind={shapeKind}
          camera={cam.camera}
          doc={doc}
          identity={identityId}
          undo={undoController}
          onCreated={toolCreated}
        />
      )}
      {tool === 'connector' && editable && (
        <ConnectorTool
          camera={cam.camera}
          doc={doc}
          identity={identityId}
          undo={undoController}
          onCreated={toolCreated}
        />
      )}
      <Toolbar
        onCreateSticky={handleCreateStickyCentred}
        disabled={!editable}
        undo={undoState}
        tool={tool}
        onToolChange={setTool}
        shapeKind={shapeKind}
        onShapeKindChange={setShapeKind}
      />
      <SelectionOverlay
        ids={sel.ids}
        snapshot={objects}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {showNoteToolbar && singleSticky && selBox && (
        <div style={barStyle}>
          <NoteToolbar
            color={singleSticky.color}
            editable={editable}
            onColor={(c) => {
              // Story 8: one colour change is exactly one undo step.
              undoController.boundary();
              setStickyColor(doc, singleSticky.id, c);
              undoController.boundary();
            }}
            onDelete={() => {
              // Story 8: one delete is exactly one undo step.
              undoController.boundary();
              if (deleteObject(doc, singleSticky.id)) sel.clear();
              undoController.boundary();
            }}
          />
        </div>
      )}
      {/* Story 9: exactly one selected text object → the text toolbar. */}
      {showTextToolbar && singleTextId && singleTextSize !== undefined && selBox && (
        <div style={barStyle}>
          <TextToolbar
            size={singleTextSize}
            onSize={(s) => {
              // Story 8: one size change is exactly one undo step. The
              // remeasure keeps x/y and writes only width/height (text.size).
              undoController.boundary();
              setTextSize(doc, singleTextId, s);
              remeasureTextBox(doc, singleTextId, measurer);
              undoController.boundary();
            }}
            onDelete={() => {
              undoController.boundary();
              deleteObjects(doc, [singleTextId]);
              sel.clear();
              undoController.boundary();
            }}
          />
        </div>
      )}
      {sel.ids.size >= 2 && barStyle && (
        <div style={barStyle}>
          <SelectionBar ids={sel.ids} disabled={!editable} onDelete={handleDeleteSelection} />
        </div>
      )}
      {/* Story 10: exactly one selected shape → the colour toolbar. */}
      {showShapeToolbar && singleShape && selBox && (
        <div style={barStyle}>
          <ShapeToolbar
            fill={singleShape.style.fill}
            stroke={singleShape.style.stroke}
            onFill={(c) => {
              // Story 8: one colour change is exactly one undo step
              // (shape.style: label, size, position and selection unchanged).
              undoController.boundary();
              setShapeStyle(doc, singleShape.id, { fill: c });
              undoController.boundary();
            }}
            onStroke={(c) => {
              undoController.boundary();
              setShapeStyle(doc, singleShape.id, { stroke: c });
              undoController.boundary();
            }}
          />
        </div>
      )}
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={cam.zoomStepIn}
        onZoomOut={cam.zoomStepOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated && notes.length === 0} />
    </BoardContext.Provider>
  );
}
