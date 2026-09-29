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
import { getObjectType } from '../objects/registry.tsx';
import { useTool } from './useTool.ts';
import { useClientId } from './useClientId.ts';
import { createText } from '../../shared/objects/text.ts';
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
import { createSticky, objectBounds, type ObjectSnapshot } from '../../shared/board-model.ts';

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

  // Story 9: the Text tool. While it is active a click on the board (empty space or
  // on top of an object) drops a text there, hands the tool back to Select and opens
  // its editor with the caret at the end. The tool lives here (above the viewport)
  // because placing a text also touches the selection.
  const tool = useTool(editable);
  const clientId = useClientId();
  const onPlaceText = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      const id = createText(doc, world, clientId);
      tool.setTool('select');
      if (id) sel.startEdit(id);
    },
    [doc, clientId, sel, tool],
  );

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
    setTool: tool.setTool,
    onCreateSticky,
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
      <div data-testid="app" className="vidi6-root">
        <BoardViewport
          camera={cam.camera}
          viewportRef={viewportRef}
          api={cam}
          marquee={marquee}
          onBackgroundPointerDown={onBackgroundPointerDown}
          onBackgroundDoubleClick={createAtWorld}
          textPlacing={tool.tool === 'text'}
          onPlaceText={onPlaceText}
        >
          {objects.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null; // a type this build cannot draw is drawn by nobody
            const ObjectType = spec.Component;
            return (
              <ObjectType
                key={obj.id}
                obj={obj}
                doc={doc}
                zoom={cam.camera.zoom}
                selected={sel.ids.has(obj.id)}
                editing={editable && sel.editingId === obj.id}
                canEdit={editable}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onObjectDoubleClick={(_e, id) => {
                  if (!editable) return; // double-clicking is an edit
                  sel.startEdit(id);
                }}
                onStartEdit={sel.startEdit}
                onEndEdit={sel.endEdit}
              />
            );
          })}
          {/* The marquee box is drawn in board units, inside the zoomed layer. */}
          <MarqueeRect rect={marquee.rect} camera={cam.camera} />
        </BoardViewport>

        <Toolbar
          onCreateSticky={onCreateSticky}
          canEdit={editable}
          disabled={!editable}
          undo={undo}
          tool={tool.tool}
          onSelectTool={tool.setTool}
        />

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
      </div>
    </UndoControllerContext.Provider>
  );
}

/** Where a floating toolbar sits: above the top-centre of one object. */
function objectAnchor(camera: Camera, obj: ObjectSnapshot): Point {
  const r = objectBounds(obj);
  return worldToScreen(camera, { x: r.x + r.width / 2, y: r.y });
}
