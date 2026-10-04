/**
 * The board itself: viewport, objects, the selection and its controls, zoom
 * controls and the connection badge, showing the one board `boardId` names.
 *
 * This is the whole of what story 1..4 put in `App.tsx`. Story 5 moved it here
 * unchanged and put a page around it (`pages/BoardPage.tsx`) whose only new job is
 * to find out whether that board exists before showing this — so nothing about
 * navigating, note editing or syncing is different because a board now has to have
 * been created to be seen.
 *
 * Story 7 put three things here: the objects are drawn through the type registry
 * rather than one component at a time; selection, moving and resizing are one
 * gesture hook shared by every type; and the keyboard works on the whole selection
 * at once.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

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
} from '../canvas/camera';
import { CameraContext, useCamera, useViewportSize } from '../canvas/useCamera';
import { registerTestHooks } from '../canvas/testHooks';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useBoardKeys } from './useBoardKeys';
import { BoardEnvProvider, type BoardEnv } from './boardEnv';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { useTransformGesture } from './useTransformGesture';
import { createUndo } from './undo';
import { UndoControllerContext, useUndo } from './useUndo';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import {
  getObjectType,
  handlesFor,
  isSelectableObjectType,
  type ObjectProps,
} from '../objects/registry';
import { createText, textSnapshot } from '../../shared/objects/text';
import { createShape, readShapes } from '../../shared/objects/shape';
import { createConnector, readConnectors } from '../../shared/objects/connector';
import { createStroke, readStrokes } from '../../shared/objects/stroke';
import { readImages } from '../../shared/objects/image';
import { useImageInsert } from '../images/useImageInsert';
import { DropHighlight } from '../images/DropHighlight';
import { Toast, useToast } from '../ui/Toast';
import { ImageInsertProvider } from '../images/ImageInsertContext';
import type { PenColor, PenThickness } from '../../shared/config';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import type { ShapeKind } from '../../shared/config';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
} from '../../shared/config';
import {
  allObjectIds,
  createSticky,
  deleteObjects,
  objectBounds,
  objectsInRect,
  objectSnapshots,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { HANDLES, unionRects, type Handle, type Rect } from '../../shared/geometry';

/** Screen offset between a selection's top-left and its floating toolbar. */
const NOTE_TOOLBAR_GAP = 8;

/**
 * Whether this page may change the board right now.
 *
 * Everything the user does here is a local change to a document that syncs later, so
 * almost every state leaves the board editable: a dropped connection keeps the edits,
 * and they go out when it returns. One state is different. When the room says it
 * could not load the board, the document in front of the person is not a copy of
 * anything — an edit made now is a change to a board that does not exist, by them
 * alone. So creating, dragging, typing, recolouring and deleting stop while it says
 * so, and start again on their own the moment the board arrives.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function BoardSurface({ boardId }: { boardId: string }) {
  const viewport = useViewportSize();
  const board = useCamera(viewport);
  const { camera } = board;
  const { doc, objects, connection } = useBoardDoc(boardId);

  // The one thing the connection state changes about the board itself.
  const editable = canEdit(connection);
  // Story 10: the box of every object, and the shape this page draws next. The rects
  // are computed once per snapshot and given to the objects through context, so an
  // arrow's ends and a tool's hover test read the same boxes the board is drawing.
  const appRef = useRef<HTMLDivElement>(null);

  // What this page has selected, kept honest about what the board still holds: an
  // object somebody else deleted leaves the selection here (TC-35).
  const presentIds = useMemo(() => new Set(objects.map((object) => object.id)), [objects]);
  const selection = useSelection(presentIds);

  // Story 8: one undo controller per board document, living only in this tab.
  // It captures only this person's own changes (see `createUndo`), and it is
  // destroyed when the board is left or swapped, so a reload starts empty
  // (PRD undo.session_only). `BoardPage` keys `BoardSurface` by board id, so
  // opening another board tears this one down and this cleanup effect runs.
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);
  const undoState = useUndo(undoController, editable);

  const gestures = useTransformGesture({
    doc,
    editable,
    camera,
    objects,
    selectedIds: selection.ids,
    click: selection.click,
    toggle: selection.toggle,
    // A whole drag or resize is one undo step: close the capture window at its
    // start and again when the pointer stops (including a cancel).
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  // Expose the live document to tests (no-op in production builds).
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    registerTestHooks({
      doc,
      getNotes: () => snapshot(doc) as StickySnapshot[],
      getTexts: () => [...textSnapshot(doc)],
      getShapes: () => readShapes(doc),
      getConnectors: () => readConnectors(doc),
      // Story 11: the sketches on the board, for assertions about a finished stroke.
      getStrokes: () => readStrokes(doc),
      getImages: () => readImages(doc),
      // …and one laid out from a recorded pointer path, so an e2e test does not have to
      // draw a big loop by mouse to have something to select. The points are board
      // points, and the defaults are the pen's own.
      seedStroke: (points: readonly Point[], color?: PenColor, thickness?: PenThickness) =>
        createStroke(
          doc,
          {
            points,
            color: color ?? DEFAULT_PEN_COLOR,
            thickness: thickness ?? DEFAULT_PEN_THICKNESS,
          },
          'seed',
        ) ?? '',
      seedSticky: (x: number, y: number) => createSticky(doc, { x, y }),
      // Story 10: lay out a board for a test instead of drawing it by hand. The point is
      // the centre, the way `seedSticky` reads, and the box is the standard one.
      seedShape: (kind: ShapeKind, x: number, y: number) =>
        createShape(doc, { kind, rect: null, at: { x, y }, square: false }, 'seed') ?? '',
      // …and an arrow between two objects that are already there, each end hanging from
      // the side that faces the other, which is what a drag between them would make.
      seedConnector: (fromId: string, toId: string) => seedConnector(doc, fromId, toId),
      selectedIds: () => [...selectionRef.current.ids],
      objectCount: () => objectSnapshots(doc).length,
      canUndo: () => undoController.canUndo(),
      canRedo: () => undoController.canRedo(),
      undoStep: () => undoController.undo(),
      redoStep: () => undoController.redo(),
    });
  }, [doc, undoController]);

  // Create a note centred on a world point, then select + edit it. The creation
  // is one undo step, closed off from the edit that follows it.
  const createAtWorld = useCallback(
    (world: Point) => {
      if (!canEdit(connection)) return; // a note added to a board that never arrived
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [doc, selection, connection, undoController],
  );

  // The Sticky note button creates a note at the centre of the visible area.
  const createAtCentre = useCallback(() => {
    createAtWorld(screenCentre(camera, viewport));
  }, [camera, viewport, createAtWorld]);

  // The tool this page is holding, the `N` shortcut (which does what the Sticky note
  // button does), the shape the Shape tool will draw next, and `toolCreated`: the one
  // call every creating tool makes when it has made something, which selects it and puts
  // the hand back to Select (PRD tool.return_to_select).
  // Story 6 owns identity; until it exists, a text object records the page that
  // made it. A random per-load id is enough for `createdBy` (presence and export),
  // and nothing on the board changes because of it. See NOTES.md.
  const identity = useRef(`page_${crypto.randomUUID()}`).current;

  // Story 12: a timestamp that updates every 30s for stale-upload detection.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Story 12: images
  const toast = useToast();
  const imageInsert = useImageInsert({
    doc,
    boardId,
    camera,
    viewport,
    connection,
    identityId: identity,
    toast,
  });

  const tools = useActiveTool({
    canEdit: editable,
    onCreateSticky: createAtCentre,
    select: (id: string) => selection.select(id),
    onOpenImagePicker: imageInsert.openPicker,
  });

  // Story 11: what this page's pen is set to. Session state, exactly like the shape kind:
  // a colour two people are holding is not something the board has to agree about, and
  // the choice lasts until the page is reloaded (PRD pen.options.reload).
  const pen = usePenOptions();

  // Story 10: what the objects and tools can look at beyond their own fields — the
  // boxes of everything, the live document, and the way from a screen point to a board
  // point. One value, given once, for the arrow that derives its line from the boxes of
  // two other objects and for the tools that need to know what is under the pointer.
  const rects = useMemo(
    () => new Map(objects.map((object) => [object.id, objectBounds(object)])),
    [objects],
  );
  const env = useMemo<BoardEnv>(
    () => ({
      camera,
      objects,
      rects,
      doc,
      editable,
      identity,
      toWorld: (client) => {
        // The board area fills the window, and the app element is that area: subtracting
        // its box costs nothing where it is at the origin, and keeps the conversion right
        // if a later story puts the board inside a page with margins.
        const box = appRef.current?.getBoundingClientRect();
        return screenToWorld(camera, {
          x: client.x - (box?.left ?? 0),
          y: client.y - (box?.top ?? 0),
        });
      },
    }),
    [camera, objects, rects, doc, editable, identity],
  );

  // Text is created where the pointer clicked — its top-left, not its centre — and
  // is edited straight away, with the tool put back in its box (PRD text.create).
  const createTextAtWorld = useCallback(
    (world: Point) => {
      if (!canEdit(connection)) return; // text added to a board that never arrived
      undoController.boundary();
      const id = createText(doc, world, identity);
      undoController.boundary();
      tools.setTool('select');
      if (id) selection.startEdit(id);
    },
    [doc, identity, selection, connection, undoController, tools],
  );

  // One delete (of any number of objects) is one undo step, bounded on each side.
  const deleteSelection = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [doc, editable, selection, undoController]);

  useBoardKeys({
    doc,
    editable,
    objects,
    isSelectable: isSelectableObjectType,
    selectedIds: selection.ids,
    editingId: selection.editingId,
    selectAll: () => selection.setMany(allObjectIds(objects, isSelectableObjectType), false),
    clear: selection.clear,
    startEdit: selection.startEdit,
    deleteSelection,
    undo: undoState.undo,
    redo: undoState.redo,
    boundary: undoController.boundary,
  });

  // Shift + drag over empty space: the viewport owns the rectangle, the model owns
  // the rule about what is inside it.
  const marqueeSelect = useCallback(
    (rect: Rect, additive: boolean) => {
      selection.setMany(objectsInRect(objects, rect, isSelectableObjectType), additive);
    },
    [objects, selection],
  );

  // Render in a stable order (by id) so bringing an object to front — which
  // changes its z — never reorders the DOM and remounts it mid-drag. Stacking comes
  // from each object's CSS z-index instead. An object of a type this client cannot
  // draw is left out (forward compatibility); it cannot be selected either.
  const renderObjects = useMemo(
    () => objects.filter((object) => getObjectType(object.type) !== undefined).sort(byId),
    [objects],
  );

  const selectedObjects = useMemo(
    () => renderObjects.filter((object) => selection.ids.has(object.id)),
    [renderObjects, selection.ids],
  );

  // One outline around the whole selection, in board units.
  const selectionBox = useMemo(
    () => unionRects(selectedObjects.map(objectBounds)),
    [selectedObjects],
  );
  const transforming = gestures.mode !== 'idle';
  // While a resize is running the outline follows the box being dragged, which is
  // the result of the limit check rather than the selection. The handles go with it:
  // they stay the same eight, so the one under the pointer is still there from frame
  // to frame, and they move with the box the way a real control does.
  const outline = gestures.mode === 'resizing' && gestures.box ? gestures.box : selectionBox;
  const handles = resizeHandlesFor(selectedObjects);

  const toolbarAnchor = selectionBox
    ? worldToScreen(camera, { x: selectionBox.x, y: selectionBox.y })
    : { x: 0, y: 0 };
  // Hidden during a gesture: the bar must not sit under the thing being moved.
  const showBar =
    selection.count > 0 && !transforming && selection.editingId === null && selectionBox !== null;

  return (
    <UndoControllerContext.Provider value={undoController}>
    <CameraContext.Provider value={board}>
      <BoardEnvProvider value={env}>
      <ImageInsertProvider value={{
        progress: imageInsert.progress,
        retry: imageInsert.retry,
        canRetry: imageInsert.canRetry,
        remove: (id) => deleteObjects(doc, [id]),
        now: nowTick,
      }}>
      <div
        className="vidi6-app"
        ref={appRef}
        onDragEnter={(e) => imageInsert.onDragEnter(e as unknown as DragEvent)}
        onDragOver={(e) => imageInsert.onDragOver(e as unknown as DragEvent)}
        onDragLeave={(e) => imageInsert.onDragLeave(e as unknown as DragEvent)}
        onDrop={(e) => imageInsert.onDrop(e as unknown as DragEvent)}
        onPaste={(e) => imageInsert.onPaste(e as unknown as ClipboardEvent)}
      >
        {/* Hidden file input for the image picker (E2E-targetable via data-testid). */}
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp"
          data-testid="image-file-input"
          className="visually-hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              imageInsert.handleFiles(Array.from(files));
            }
            e.target.value = '';
          }}
        />
        <BoardViewport
          onCreateStickyAt={createAtWorld}
          onClearSelection={selection.clear}
          onMarqueeSelect={marqueeSelect}
          textToolActive={tools.tool === 'text' && editable}
          onCreateTextAt={createTextAtWorld}
          // The pen draws inside the surface, so a wheel over it still reaches the
          // surface's own wheel handler and the board pans and zooms as story 1 taught it
          // while the pen holds every drag (PRD pen.navigation).
          screenOverlay={
            editable && tools.tool === 'pen' ? (
              <PenTool
                camera={camera}
                color={pen.color}
                thickness={pen.thickness}
                doc={doc}
                identityId={identity}
              />
            ) : null
          }
        >
          {renderObjects.map((object) => (
            <ObjectView
              key={object.id}
              object={object}
              doc={doc}
              zoom={camera.zoom}
              editable={editable}
              selected={selection.ids.has(object.id)}
              editing={selection.editingId === object.id}
              onObjectPointerDown={gestures.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={endEditWith(selection)}
            />
          ))}
          <SelectionOverlay
            box={outline}
            zoom={camera.zoom}
            handles={handles}
            onHandlePointerDown={gestures.onHandlePointerDown}
          />
        </BoardViewport>

        {showBar && (
          <div
            className="note-toolbar-anchor"
            style={{ left: toolbarAnchor.x, top: toolbarAnchor.y - NOTE_TOOLBAR_GAP }}
          >
            <SelectionBar
              ids={selection.ids}
              objects={objects}
              doc={doc}
              editable={editable}
              onDelete={deleteSelection}
            />
          </div>
        )}

        {/* What the selection is, for a screen reader: the outline is decoration. */}
        <div className="visually-hidden" role="status" aria-live="polite">
          {selection.count > 1 ? `${selection.count} selected` : ''}
        </div>

        <Toolbar
          onCreateSticky={createAtCentre}
          createDisabled={!editable}
          undo={undoState}
          tool={tools.tool}
          onTool={tools.setTool}
          shapeKind={tools.shapeKind}
          onShapeKind={tools.setShapeKind}
          onOpenImagePicker={imageInsert.openPicker}
        />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        {/* Story 10: the tools that own the pointer. Each covers the board, so a gesture
            that happens to start on an object belongs to the tool rather than to the
            object — a drag from a note with the Shape tool draws a shape and leaves the
            note where it was (PRD tool.owns_gesture). */}
        {editable && tools.tool === 'shape' ? (
          <ShapeTool kind={tools.shapeKind} camera={camera} onCreated={tools.toolCreated} />
        ) : null}
        {editable && tools.tool === 'connector' ? (
          <ConnectorTool camera={camera} snapshot={objects} onCreated={tools.toolCreated} />
        ) : null}
        {/* Story 11: the pen's two choices, beside the toolbar that holds the pen itself.
            They are only on screen while the pen is held, and picking one changes the next
            stroke and never a stroke that is already there (PRD pen.options.no_restyle). */}
        {editable && tools.tool === 'pen' ? (
          <PenToolbar
            color={pen.color}
            thickness={pen.thickness}
            onColor={pen.setColor}
            onThickness={pen.setThickness}
          />
        ) : null}
        <NavigationHint visible={!board.hasNavigated} />
        <ConnectionStatus state={connection} />
        <DropHighlight visible={imageInsert.isDragging} />
        <Toast messages={toast.messages} />
      </div>
      </ImageInsertProvider>
      </BoardEnvProvider>
    </CameraContext.Provider>
    </UndoControllerContext.Provider>
  );
}

/**
 * One object, drawn by the component its type registered. Everything the component
 * needs arrives as one props object, so a type added by a later story needs no
 * change to this file.
 */
function ObjectView(props: ObjectProps) {
  const spec = getObjectType(props.object.type);
  if (!spec) return null;
  const { Component } = spec;
  return <Component {...props} />;
}

/**
 * The handles to draw: the eight of a box, when every selected object can be
 * resized. A type that cannot be resized (a future stroke) takes the handles away
 * from a mixed selection too — a control that does nothing is worse than none.
 */
function resizeHandlesFor(objects: readonly ObjectSnapshot[]): readonly Handle[] {
  if (objects.length === 0) return [];
  if (!objects.every((object) => getObjectType(object.type)?.resizable)) return [];
  // Story 9: a selection of nothing but text gets the left and right edges, because
  // its height belongs to its content and no drag should set it (PRD text.height).
  return handlesFor(objects.map((object) => object.type)) === 'horizontal' ? SIDE_HANDLES : HANDLES;
}

/** The two edges of a text object, in the order the ring draws them. */
const SIDE_HANDLES: readonly Handle[] = ['e', 'w'];

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ending an edit leaves the object selected, ready to be moved again. */
function endEditWith(selection: ReturnType<typeof useSelection>) {
  return (next: 'selected' | 'unselected') => {
    if (next === 'selected') selection.stopEdit();
    else selection.clear();
  };
}

/**
 * An arrow between two objects that are already on the board, for tests that lay a
 * board out rather than dragging one together. Each end hangs from the side facing the
 * other object, which is exactly what a drag between them would have stored.
 */
function seedConnector(doc: Y.Doc, fromId: string, toId: string): string {
  const rects = new Map(objectSnapshots(doc).map((object) => [object.id, objectBounds(object)]));
  const a = rects.get(fromId);
  const b = rects.get(toId);
  if (!a || !b) return '';
  const centre = (r: { x: number; y: number; width: number; height: number }) => ({
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
  });
  const from = sideAnchor(a, nearestSide(a, centre(b)));
  const to = sideAnchor(b, nearestSide(b, centre(a)));
  return (
    createConnector(
      doc,
      { kind: 'attached', objectId: fromId, fallbackX: from.x, fallbackY: from.y },
      { kind: 'attached', objectId: toId, fallbackX: to.x, fallbackY: to.y },
      'seed',
    ) ?? ''
  );
}

function screenCentre(
  camera: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
): Point {
  // The world point at the centre of the visible board area.
  return screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
}
