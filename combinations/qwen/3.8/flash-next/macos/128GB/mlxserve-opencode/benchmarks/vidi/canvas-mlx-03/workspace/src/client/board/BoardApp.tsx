// The board page's component tree (stories 1-4), mounted by `BoardPage` only once
// the board's link has been checked (story 5): camera, sticky notes, live
// collaboration and the persistence states — and the Share control in the header.
// Nothing in here (Yjs doc, WebSocket, canvas) ever exists for a link that is not
// a board, which is what share.not_found's "nothing is created there" means on
// the client side.
//
// Story 7 added selection of several objects at once. What that changed here is
// only *what is rendered*: the world layer now draws every object the document
// holds, asking `objects/registry.tsx` which component belongs to which type, and
// the toolbars come from the type's registration too. Selection, marquee, group
// move, group resize, deletion and the keyboard commands live in `board/*` and
// treat every object type the same way, so stories 9-12 (text, shape, connector,
// frame) add a component and one registration instead of touching this file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../canvas/BoardViewport.tsx';
import { ZoomControls } from '../canvas/ZoomControls.tsx';
import { NavigationHint } from '../canvas/NavigationHint.tsx';
import { Toolbar } from './Toolbar.tsx';
// Registers the 'sticky' object type; the renderer below asks the registry what to
// draw, so the module must have been evaluated.
import '../objects/StickyNote.tsx';
// Story 9: registers the 'text' object type the same way.
import '../objects/TextObject.tsx';
// Story 10: registers the 'shape' and 'connector' object types the same way.
import '../objects/ShapeObject.tsx';
import '../objects/ConnectorObject.tsx';
// Story 11: registers the 'stroke' object type the same way.
import '../objects/StrokeObject.tsx';
// Story 12: registers the 'image' object type, and is imported for its component too — a
// picture needs three facts about *this tab* (its identity, its upload progress and whether it
// still holds the file) that no other object type has any use for.
import { ImageObjectView, useImageClock } from '../objects/ImageObject.tsx';
import { useImageInsert } from '../images/useImageInsert.ts';
import { DropHighlight } from '../images/DropHighlight.tsx';
import { ToastHost } from '../ui/Toast.tsx';
import { getObjectType } from '../objects/registry.tsx';
import { useActiveTool } from '../tools/useActiveTool.ts';
import { ShapeTool } from '../tools/ShapeTool.tsx';
import { ConnectorTool } from '../tools/ConnectorTool.tsx';
import { PenTool } from '../tools/PenTool.tsx';
import { PenToolbar } from '../tools/PenToolbar.tsx';
import { usePenOptions } from '../tools/usePenOptions.ts';
import { useClientId } from './useClientId.ts';
import { createText } from '../../shared/objects/text.ts';
import { objectRectsOf } from '../../shared/objects/connector.ts';
import { useCamera } from '../canvas/useCamera.ts';
import { useBoardDoc } from './useBoardDoc.ts';
import { useSelection } from './useSelection.ts';
import { useTransformGesture, deleteSelection } from './useTransformGesture.ts';
import { useMarquee, MarqueeRect } from './Marquee.tsx';
import { useBoardKeys } from './useBoardKeys.ts';
import { createUndo, type UndoController } from './undo.ts';
import { UndoControllerContext, useUndo } from './useUndo.ts';
import { SelectionOverlay, selectionBounds } from './SelectionOverlay.tsx';
import { SelectionBar } from './SelectionBar.tsx';
import { ConnectionStatus, type ConnectionState } from './ConnectionStatus.tsx';
import SharePanel from './SharePanel.tsx';
import { isValidBoardId } from '../../shared/board-id.ts';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  screenToWorld,
  worldToScreen,
  type Size,
  type Point,
  type Camera,
} from '../canvas/camera.ts';
import { createSticky, deleteObjects, objectBounds, type ObjectSnapshot } from '../../shared/board-model.ts';

export interface BoardAppProps {
  /** Component tests inject their own document; production omits this. */
  doc?: Y.Doc;
  /** Board id from the /b/:boardId route; component tests may omit it. */
  boardId?: string | null;
  /** Component tests force a connection state (TC-23); production omits it. */
  connection?: ConnectionState;
  /** Component tests inject their own undo controller (undo.controls); production omits it. */
  undo?: UndoController;
}

/**
 * Whether the board may be edited. Everything except a board whose storage could
 * not be read is editable: a reconnecting board still shows its last known state
 * and its changes are retried (persist.save_failure), while a board that failed to
 * load would silently write into an empty document.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Read the board id from a /b/<valid id> path, or null (local board). */
export function boardIdFromPath(path: string): string | null {
  const m = /^\/b\/([^/]+)/.exec(path);
  const id = m?.[1];
  return id && isValidBoardId(id) ? id : null;
}

/**
 * The board page's tree: camera (story 1), sticky notes (story 2), live
 * collaboration (story 3), persistence states (story 4), the Share control in the
 * header (story 5) and multi-object selection (story 7).
 *
 * `BoardPage` mounts this only after the link has been checked, so nothing here
 * (Yjs doc, WebSocket, canvas) ever exists for a link that is not a board.
 */
export default function BoardApp(props: BoardAppProps = {}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 1280, height: 800 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setViewport({ width: r.width, height: r.height });
    });
    ro.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const cam = useCamera(viewport);
  const boardId = props.boardId ?? boardIdFromPath(window.location.pathname);
  const { doc, objects, connection } = useBoardDoc(props.doc, boardId, props.connection);

  // Story 8: one undo history per board document, made here because this is where
  // the document is, and disposed with it. Switching to another board link builds a
  // new document and a new controller, so a history is never carried from one board
  // to another, and nothing about it is ever saved (undo.session_only).
  const ownUndo = useMemo(
    () => (props.undo ? null : createUndo(doc)),
    [props.undo, doc],
  );
  useEffect(() => () => ownUndo?.destroy(), [ownUndo]);
  const undoController = props.undo ?? ownUndo!;

  // The selection is local, and it follows the document: an object a colleague
  // deleted cannot stay selected (TC-35), and selecting the same object as a
  // colleague does not make it "mine".
  const sel = useSelection(objects);

  // Editing gates read the state through a ref so the window-level handlers
  // registered once can never act on a stale state.
  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  // True between the start of a group move/resize and its end: it hides the
  // floating toolbars so they do not jump around mid-gesture (F-05), and it is the
  // only hook story 8 needs for "my selection is in use".
  const [transforming, setTransforming] = useState(false);

  // Create a note centred on a world point, then select + edit it.
  const createAtWorld = useCallback(
    (world: Point) => {
      if (!editableRef.current) return; // a board we could not load is not editable
      const id = createSticky(doc, world);
      sel.startEdit(id);
    },
    // `sel`'s actions are stable, but depend on it so a fresh board is never edited
    // through a stale one.
    [doc, sel],
  );

  // Toolbar button: centred in the visible board area.
  const onCreateSticky = useCallback(() => {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtWorld(screenToWorld(cam.camera, centre));
  }, [createAtWorld, viewport.width, viewport.height, cam.camera]);

  // Empty-space press clears selection (and any in-progress edit).
  const onBackgroundPointerDown = useCallback(() => {
    sel.endEdit('unselected');
  }, [sel]);

  // Story 9: the Text tool, and story 10's Shape and Connector tools: while one of
  // them is armed the next gesture on the board belongs to the tool, and the tool that
  // created something hands the board back to Select with the new object selected.
  // The tools live here (above the viewport) because creating an object also touches
  // the selection.
  const active = useActiveTool({ canEdit: editable, select: (id) => sel.click(id) });
  const clientId = useClientId();
  const onPlaceText = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      const id = createText(doc, world, clientId);
      active.setTool('select');
      if (id) sel.startEdit(id);
    },
    [doc, clientId, sel, active],
  );

  // Story 11: what the pen draws with. Session state only — never shared, never kept
  // for the next session (pen.options) — so it is not in the document and not in the
  // undo history, and a reload starts the pen at its defaults.
  const pen = usePenOptions();

  // Story 12: the three ways a picture arrives — dropped, pasted, chosen — and the uploads they
  // start. It is mounted here because it needs the document, the board's address, the camera to
  // turn a drop point into board units, the connection to refuse an upload a disconnected board
  // cannot finish, and this tab's identity to know which failed upload it may offer to retry.
  const insert = useImageInsert({
    doc,
    boardId: boardId ?? '',
    camera: cam.camera,
    connection,
    identityId: clientId,
    viewport: { width: viewport.width, height: viewport.height },
  });
  // The clock the pictures are read against: it advances only while something on this board is
  // still uploading, which is when a box's meaning is the thing that changes (image.unfinished).
  const imageNow = useImageClock(objects);
  // Paste is listened for on the window, so a picture can be pasted without first clicking the
  // board; the handler is reached through a ref so the listener is registered once and never
  // re-registered by an upload's progress.
  const insertRef = useRef(insert);
  insertRef.current = insert;
  useEffect(() => {
    const onWindowPaste = (event: ClipboardEvent) => insertRef.current.onPaste(event);
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, []);
  // Remove on a picture's box deletes that one object, as one undo step: undoing the removal of
  // a photograph should not undo the note typed beside it, and vice versa.
  const onImageRemove = useCallback(
    (id: string) => {
      if (!editableRef.current) return; // a board that could not be loaded is not editable
      undoController.boundary();
      deleteObjects(doc, [id]);
      undoController.boundary();
    },
    [doc, undoController],
  );

  // The four drag events, handed to the board's surface. React's synthetic event wraps the DOM's
  // own DragEvent, which is what the insert hook is written against — the same object, so
  // `preventDefault` and `dataTransfer` mean what they normally mean. Reading the hook through a
  // ref keeps these four handlers stable across an upload's progress updates.
  const drag = useCallback(
    (which: 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop') =>
      (event: React.DragEvent<HTMLDivElement>) =>
        insertRef.current[which](event.nativeEvent),
    [],
  );

  // The rectangles every arrow resolves its attached ends against, built once per
  // render and handed to every object: an arrow follows a shape anybody moved because
  // it reads this map, not because anything was written about it.
  const rects = useMemo(() => objectRectsOf(objects), [objects]);

  // Shift+drag on empty space draws a box; what it fully encloses is added to the
  // selection (a box that catches nothing changes nothing).
  const marquee = useMarquee(cam.camera, objects, (ids) => {
    if (ids.length > 0) sel.setMany(ids, true);
  });

  // Drag an object: move the whole selection. Drag a handle: resize it.
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => setTransforming(true),
    onGestureEnd: () => setTransforming(false),
    // Story 8: one gesture, one undo step. The hook puts this at both ends of the
    // gesture itself, so the frames in between merge and a drag is never merged
    // with the click that selected it or the colour chosen right after it.
    boundary: undoController.boundary,
  });

  // Ctrl/Cmd+A, Escape, arrow-key nudging and Delete/Backspace. All of them are
  // suppressed while a text editor has the keyboard.
  useBoardKeys({
    doc,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
    setTool: active.setTool,
    onCreateSticky,
    onAddImages: insert.openPicker,
  });

  // What the Undo/Redo buttons render from, and what the shortcuts act on: this
  // tab's two stacks. A colleague's activity never changes them.
  const undo = useUndo(undoController, editable);

  const onDelete = useCallback(() => {
    deleteSelection(doc, sel, editable);
  }, [doc, sel, editable]);

  const stop = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) =>
    e.stopPropagation();

  // The objects in stacking order: the snapshot is already sorted by z, and DOM
  // order is what paints on top.
  const selected = objects.filter((o) => sel.ids.has(o.id));
  // Exactly one selected object gets its own type's toolbar (a note's colours); two
  // or more get the selection bar instead — never both.
  const sole = selected.length === 1 ? selected[0]! : null;
  const SoleToolbar = sole ? getObjectType(sole.type)?.toolbar : undefined;
  const showSoleToolbar =
    SoleToolbar != null && sole != null && sel.editingId !== sole.id && !transforming;

  // Both toolbars float above the object's (or the selection's) top-centre, in
  // screen space, so they keep a stable size at any zoom.
  const solePoint = sole ? objectAnchor(cam.camera, sole) : null;
  let noteToolbarStyle: React.CSSProperties = { position: 'fixed', left: -9999, top: -9999 };
  if (solePoint) {
    noteToolbarStyle = {
      position: 'fixed',
      left: solePoint.x,
      top: Math.max(4, solePoint.y - 46),
      zIndex: 30,
    };
  }
  // The bar floats above the top-centre of the box around the selection, in screen
  // space, so it keeps a stable size at any zoom.
  const barBox = sel.ids.size >= 2 ? selectionBounds(sel.ids, objects) : null;
  const barPoint = barBox
    ? worldToScreen(cam.camera, { x: barBox.x + barBox.width / 2, y: barBox.y })
    : null;

  return (
    <UndoControllerContext.Provider value={undoController}>
      <div
        data-testid="app"
        className="vidi6-root"
        onDragEnter={drag('onDragEnter')}
        onDragOver={drag('onDragOver')}
        onDragLeave={drag('onDragLeave')}
        onDrop={drag('onDrop')}
      >
        <BoardViewport
          camera={cam.camera}
          viewportRef={viewportRef}
          api={cam}
          marquee={marquee}
          onBackgroundPointerDown={onBackgroundPointerDown}
          onBackgroundDoubleClick={createAtWorld}
          textPlacing={active.tool === 'text'}
          onPlaceText={onPlaceText}
          cursor={active.tool === 'shape' || active.tool === 'connector' ? 'crosshair' : undefined}
          penActive={active.tool === 'pen'}
        >
          {objects.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null; // a type this build cannot draw is drawn by nobody
            const ObjectType = spec.Component;
            const common = {
              obj,
              doc,
              zoom: cam.camera.zoom,
              camera: cam.camera,
              rects,
              objects,
              selected: sel.ids.has(obj.id),
              editing: editable && sel.editingId === obj.id,
              canEdit: editable,
              onObjectPointerDown: gesture.onObjectPointerDown,
              onObjectDoubleClick: (
                _e: React.MouseEvent<HTMLElement>,
                id: string,
              ) => {
                if (!editable) return; // double-clicking is an edit
                sel.startEdit(id);
              },
              onStartEdit: sel.startEdit,
              onEndEdit: sel.endEdit,
            };
            // A picture is the one type that is told about this tab: whose upload it is, how far
            // that upload has got, whether the file is still here to send again, and what time it
            // is. No other type is given any of it, and none of it changes how they render.
            if (obj.type === 'image') {
              return (
                <ImageObjectView
                  key={obj.id}
                  {...common}
                  imageProgress={insert.progress.get(obj.id)}
                  imageIdentityId={clientId}
                  imageCanRetry={insert.canRetry(obj.id)}
                  imageNow={imageNow}
                  onImageRetry={insert.retry}
                  onImageRemove={onImageRemove}
                />
              );
            }
            return <ObjectType key={obj.id} {...common} />;
          })}
          {/* The marquee box is drawn in board units, inside the zoomed layer. */}
          <MarqueeRect rect={marquee.rect} camera={cam.camera} />
        </BoardViewport>

        <Toolbar
          onCreateSticky={onCreateSticky}
          onAddImages={insert.openPicker}
          canEdit={editable}
          disabled={!editable}
          undo={undo}
          tool={active.tool}
          onSelectTool={active.setTool}
          shapeKind={active.shapeKind}
          onSelectShapeKind={active.setShapeKind}
        />

        {/* Story 10: the two tools that draw with a gesture. They render only their own
            screen-space preview and take the board's pointer while they are armed; both
            are mounted as neighbours of the viewport, never inside the zoomed layer, so
            a preview keeps its size at any zoom. */}
        {active.tool === 'shape' ? (
          <ShapeTool
            kind={active.shapeKind}
            doc={doc}
            by={clientId}
            camera={cam.camera}
            viewportRef={viewportRef}
            canEdit={editable}
            onCreated={active.toolCreated}
          />
        ) : null}
        {active.tool === 'connector' ? (
          <ConnectorTool
            doc={doc}
            by={clientId}
            camera={cam.camera}
            snapshot={objects}
            viewportRef={viewportRef}
            canEdit={editable}
            onCreated={active.toolCreated}
          />
        ) : null}

        {/* Story 11: the Pen tool. Like the two above it it is mounted as a neighbour of
            the viewport, never inside the zoomed layer, so the stroke in hand and the
            round pointer are drawn in screen pixels and keep their size at any zoom; the
            stroke it finishes is written into the document in board units. */}
        {active.tool === 'pen' ? (
          <PenTool
            camera={cam.camera}
            color={pen.color}
            thickness={pen.thickness}
            doc={doc}
            identityId={clientId}
            viewportRef={viewportRef}
            canEdit={editable}
          />
        ) : null}

        {/* The pen's own options, beside the board toolbar rather than above the board:
            they belong to the tool, not to any object on the board (pen.options). */}
        {active.tool === 'pen' ? (
          <div
            data-testid="pen-toolbar-anchor"
            style={{ position: 'fixed', left: 84, top: '50%', transform: 'translateY(-50%)', zIndex: 30 }}
            onPointerDown={stop}
            onDoubleClick={stop}
            onWheel={stop}
          >
            <PenToolbar
              color={pen.color}
              thickness={pen.thickness}
              onColor={pen.setColor}
              onThickness={pen.setThickness}
            />
          </div>
        ) : null}

        {showSoleToolbar && sole && SoleToolbar ? (
          <div
            data-testid="note-toolbar-anchor"
            style={noteToolbarStyle}
            onPointerDown={stop}
            onDoubleClick={stop}
            onWheel={stop}
          >
            <SoleToolbar doc={doc} obj={sole} canEdit={editable} onDelete={onDelete} />
          </div>
        ) : null}

        {/* Two or more selected: "N selected" and one button that deletes them all. */}
        {!transforming && barPoint ? (
          <div
            data-testid="selection-bar-anchor"
            style={{
              position: 'fixed',
              left: barPoint.x,
              top: Math.max(4, barPoint.y - 46),
              zIndex: 30,
            }}
            onPointerDown={stop}
            onDoubleClick={stop}
            onWheel={stop}
          >
            <SelectionBar ids={sel.ids} snapshot={objects} onDelete={onDelete} />
          </div>
        ) : null}

        {/* One box around the whole selection with eight handles, drawn in screen
            space so a handle is the same size on screen whatever the zoom. The
            wrapper passes pointer events through to the board; only the handles take
            them. Handles are hidden while text is being edited. */}
        {!sel.editingId ? (
          <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 25 }}>
            <SelectionOverlay
              ids={sel.ids}
              snapshot={objects}
              camera={cam.camera}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
          </div>
        ) : null}

        {/* Assistive technology is told how many objects are selected: the visible bar
            cannot announce itself, since it appears and disappears with the count. */}
        <span
          data-testid="selection-live"
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {selected.length > 1 ? `${selected.length} selected` : ''}
        </span>

        <ZoomControls
          zoomPercent={zoomPercent(cam.camera)}
          canZoomIn={canZoomIn(cam.camera)}
          canZoomOut={canZoomOut(cam.camera)}
          onZoomIn={() => cam.zoomStep('in')}
          onZoomOut={() => cam.zoomStep('out')}
          onReset={cam.reset}
        />
        <NavigationHint visible={!cam.hasNavigated} />
        {/* Story 5: the board's link, one click away (share.copy). */}
        <SharePanel />
        <ConnectionStatus status={connection} />
        {/* Story 12: the frame a dragged file is dropped inside, and the one place the board's
            sentences about pictures are said. Both are above the board and take no part in it. */}
        <DropHighlight shown={insert.dropHighlight} />
        <ToastHost />
      </div>
    </UndoControllerContext.Provider>
  );
}

/** Where a floating toolbar sits: above the top-centre of one object. */
function objectAnchor(camera: Camera, obj: ObjectSnapshot): Point {
  const r = objectBounds(obj);
  return worldToScreen(camera, { x: r.x + r.width / 2, y: r.y });
}
