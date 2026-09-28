// The board itself: canvas, objects, toolbar, zoom, connection badge, share
// panel - the whole of stories 1-4 - plus the story 7 selection machinery: one
// selection, one gesture, one overlay and one bar for every object type.
//
// It is a component rather than a page because a board is what a route *opens*,
// not what a route *is*: story 5 put the routing in <App /> and the checking of a
// link in <BoardPage />, and this is what a link that was checked renders. Both
// `boardId` and `makeProvider` are props: a board UI that read the address bar
// itself could not be rendered against a board a test chose, and the component
// suite (the read-only board, the gesture tests) does exactly that.
//
// The story 7 parts are all generic. Objects are rendered by looking their type
// up in the object registry and handing it the same `ObjectProps`; the selection
// is a Set of ids that lives only in this client; moving, resizing, nudging and
// deleting act on the whole Set through the board model; and a new object type
// gets all of it by registering itself, without touching this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewportRoot, useBoardCamera } from '../canvas/BoardViewport.tsx';
import { ZoomControls } from '../canvas/ZoomControls.tsx';
import { NavigationHint } from '../canvas/NavigationHint.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useBoardDoc } from './useBoardDoc.ts';
import { useSelection } from './useSelection.ts';
import { useTransformGesture } from './useTransformGesture.ts';
import { useBoardKeys } from './useBoardKeys.ts';
import { useActiveTool } from '../tools/useActiveTool.ts';
import { ShapeTool } from '../tools/ShapeTool.tsx';
import { ConnectorTool } from '../tools/ConnectorTool.tsx';
import { localIdentityId } from './localIdentity.ts';
import { useMarquee } from './Marquee.tsx';
import { SelectionOverlay } from './SelectionOverlay.tsx';
import { SelectionBar } from './SelectionBar.tsx';
import { createUndo, type UndoController } from './undo.ts';
import { UndoContext, useUndo } from './useUndo.ts';
import { ConnectionStatus } from '../collab/ConnectionStatus.tsx';
import type { ConnectionState, ProviderFactory } from '../collab/connectBoard.ts';
import { getObjectType } from '../objects/registry.tsx';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from '../canvas/camera.ts';
import { SharePanel } from '../share/SharePanel.tsx';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  type ObjectSnapshot,
} from '../../shared/board-model.ts';
import { createText, setTextSize } from '../../shared/objects/text.ts';
import { setShapeStyle, type ShapeStyle } from '../../shared/objects/shape.ts';
import type { StickyColor, TextSize } from '../../shared/config.ts';
import type { Point } from '../canvas/camera.ts';

// True when the board can be mutated at all (story 4). Everything else about a
// board stays usable while it is unloadable - you can pan, zoom and read it - so
// this one predicate is the only gate on every mutation path: toolbar creation,
// double-click creation, dragging, resizing, nudging, text editing, recolouring
// and deleting.
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

// True when focus is inside a text control, so board keyboard shortcuts must
// not hijack the keystroke.
function isEditableFocus(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true;
}

export interface BoardAppProps {
  /** Which board this is: the code from the address that opened it. */
  boardId: string;
  makeProvider?: ProviderFactory;
}

export default function BoardApp({ boardId, makeProvider }: BoardAppProps) {
  const { api, rootRef, viewport } = useBoardCamera();
  const board = useBoardDoc(boardId, makeProvider);
  const { doc, objects } = board;
  const cam = api.camera;

  // The single editing gate for this render (see canEdit). Held in a ref too so
  // the mutation callbacks keep a stable identity when only the state changed.
  const editable = canEdit(board.connectionState);
  const connectionStateRef = useRef<ConnectionState>(board.connectionState);
  connectionStateRef.current = board.connectionState;

  // This person's undo history, over the doc this board opened. It belongs to the
  // doc rather than to a render: it has to exist before the first mutation happens
  // (so no step is missed) and outlive every re-render (so no step is lost). A
  // board whose doc is replaced starts with an empty history again, which is what
  // a reload or a different board does (undo.session_only).
  const undoRef = useRef<{ doc: Y.Doc; controller: UndoController } | null>(null);
  if (undoRef.current === null || undoRef.current.doc !== doc) {
    undoRef.current = { doc, controller: createUndo(doc) };
  }
  const undoController = undoRef.current.controller;
  useEffect(() => {
    return () => {
      if (undoRef.current?.controller === undoController) undoRef.current = null;
      undoController.destroy();
    };
  }, [undoController]);

  // What the toolbar's Undo and Redo buttons show: the steps of this tab only,
  // and none of them offered while the board cannot be edited.
  const undoState = useUndo(undoController, editable);

  // The selection: a Set of ids owned by THIS client, never written to the doc.
  // It prunes itself as objects disappear (a remote delete), and so does the
  // text editor of an object that is no longer there.
  const selection = useSelection(objects);
  const { ids: selectedIds, editingId, setMany, clear, startEdit, endEdit } = selection;

  // The board's tool (stories 9-10): this tab's pointer meaning, never the doc's.
  // Every creation tool is a mutation door, so it is gated by the same `editable`
  // as every other path - a board that cannot be edited cannot be put into one,
  // and loses the one it had open. `toolCreated` is how a tool hands the board
  // back: the new object is selected (through the pending selection below, becau-
  // se it is not in this render's snapshot yet) and the tool is Select again.
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const tools = useActiveTool({ canEdit: editable, onSelect: (id: string) => setPendingSelect(id) });
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = tools;

  useEffect(() => {
    if (pendingSelect === null) return;
    if (!objects.some((obj) => obj.id === pendingSelect)) return;
    setMany([pendingSelect], false);
    setPendingSelect(null);
  }, [pendingSelect, objects, setMany]);

  // Shift+drag on empty space; `setMany(..., true)` so a marquee adds to the
  // selection instead of replacing it.
  const onSelectMarquee = useCallback((ids: string[]) => setMany(ids, true), [setMany]);
  const marquee = useMarquee(cam, objects, onSelectMarquee);

  // One gesture for every type: it moves or resizes whatever the selection
  // holds, and it is the only place a grab turns into model writes. The two hooks
  // are this tab's undo boundaries: every frame of one drag is captured as a
  // single step, and a gesture never merges with the action before or after it.
  // The same call runs on pointercancel, so an interrupted drag is one step too.
  const gesture = useTransformGesture({
    doc,
    camera: cam,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  // Select all, clear, nudge, delete, and the undo/redo of this person's own
  // changes. Escape is the board's own shortcut unless a marquee is being drawn,
  // in which case the viewport discards it and the selection stays as it is.
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
    escapeBlocked: () => marquee.rect !== null,
    tools,
    // N keeps its story 2 meaning; the callback is invoked long after this
    // render, when the const below is long since initialised.
    onCreateSticky: () => onCreateSticky(),
  });

  // Mirror the live connection state + socket controls onto the test-only hook
  // for e2e reconnect assertions; dead-code eliminated in prod.
  const provider = board.provider;
  useEffect(() => {
    const hook = window.__vidi6;
    if (import.meta.env.MODE !== 'test' || !hook) return;
    hook.connectionState = board.connectionState;
    hook.disconnect = () => provider?.disconnect?.();
    hook.connect = () => provider?.connect?.();
  }, [board.connectionState, provider]);

  // A note created by the toolbar or a double-click opens its editor. The id is
  // not in this render's snapshot yet (the store updates after the write), and
  // the selection ignores ids it has never seen, so the request is parked and
  // taken as soon as the object exists.
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);
  useEffect(() => {
    if (pendingEdit === null) return;
    if (!objects.some((obj) => obj.id === pendingEdit)) return;
    startEdit(pendingEdit);
    setPendingEdit(null);
  }, [pendingEdit, objects, startEdit]);

  // Create a note centred on a world point and immediately edit it. The
  // boundaries around the call make "a note was created" one undo step even when
  // the very next keystroke types into it (story 8).
  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!canEdit(connectionStateRef.current)) return;
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      setPendingEdit(id);
    },
    [doc, undoController],
  );

  // Toolbar button creates at the centre of the visible board area.
  const onCreateSticky = useCallback(() => {
    const centre = screenToWorld(cam, { x: viewport.width / 2, y: viewport.height / 2 });
    createAt(centre);
  }, [cam, viewport.width, viewport.height, createAt]);

  // Empty-space double-click creates centred on the clicked point.
  const onEmptyDoubleClick = useCallback((world: { x: number; y: number }) => createAt(world), [createAt]);

  // A click on empty space clears the selection; when a text editor was open it
  // ends it as unselected, exactly as the note's own "click away" did (TC-38).
  const onEmptyClick = useCallback(() => clear(), [clear]);

  const onColor = useCallback(
    (id: string, color: string) => {
      if (!canEdit(connectionStateRef.current)) return;
      // One click on a colour is one step of its own.
      undoController.boundary();
      setStickyColor(doc, id, color);
      undoController.boundary();
    },
    [doc, undoController],
  );

  // A text created by the Text tool lands exactly on the pressed point (not
  // centred on it like a note does) and opens its editor at once - the two
  // boundaries around the creation make "a text was created" one undo step
  // before the first keystroke joins what is typed into it (story 8, TC-25).
  const createTextAt = useCallback(
    (world: Point) => {
      if (!canEdit(connectionStateRef.current)) return;
      undoController.boundary();
      // Story 6 has not run: `createdBy` is this tab's locally generated id
      // (see localIdentity.ts) until real identities arrive.
      const id = createText(doc, world, localIdentityId());
      undoController.boundary();
      if (id !== null) setPendingEdit(id);
    },
    [doc, undoController],
  );

  // The Text tool's click: a new text exactly there, the tool given back to
  // Select, and the editor open on it (TC-17).
  const onTextToolClick = useCallback(
    (world: Point) => {
      createTextAt(world);
      setTool('select');
    },
    [createTextAt, setTool],
  );

  // The size toolbar's press: one step of its own, exactly like a colour
  // choice. The box re-measures inside the same boundaries, so "the size
  // changed" - size and grown box together - is a single undo step.
  const onTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!canEdit(connectionStateRef.current)) return;
      undoController.boundary();
      setTextSize(doc, id, size);
      undoController.boundary();
    },
    [doc, undoController],
  );

  // The selection bar's Delete: one transaction removes every selected object -
  // and that transaction is exactly one undo step, which is what makes an
  // accidental box-select-and-delete recoverable in one press - then the selection
  // that referred to them is gone. A single object's delete is the same call with
  // one id in the Set.
  const onDeleteSelection = useCallback(() => {
    if (!canEdit(connectionStateRef.current)) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    clear();
  }, [doc, selection, clear, undoController]);

  // The shape palette's press: one step of its own, exactly like a note's colour
  // or a text's size. Fill and outline are two names on the object; everything
  // else about the shape - its label, its box, its place in the z-order and the
  // selection - is left where it was (TC-20), and the arrows attached to it do not
  // even need to be told, because they resolve their ends from this shape's box at
  // the moment they draw.
  const onShapeStyle = useCallback(
    (id: string, style: Partial<ShapeStyle>) => {
      if (!canEdit(connectionStateRef.current)) return;
      undoController.boundary();
      setShapeStyle(doc, id, style);
      undoController.boundary();
    },
    [doc, undoController],
  );

  // A tool that finished creating: the new object becomes the selection and the
  // board goes back to Select. The selection is parked (see pendingSelect) because
  // the object was written this gesture and is not in the snapshot this render has.
  const onToolCreated = useCallback(
    (id: string) => {
      tools.toolCreated(id);
    },
    // `tools` is a fresh object every render; only the stable callback is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toolCreated],
  );

  // Board-level keyboard left over from story 2: Enter opens the text editor of
  // the one selected object, when its type has editable text. The rest of the
  // selection keyboard lives in useBoardKeys.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editingId !== null) return;
      if (isEditableFocus()) return;
      if (e.key !== 'Enter') return;
      if (selection.ids.size !== 1) return;
      const id = [...selection.ids][0];
      const obj = objects.find((o) => o.id === id);
      if (!obj) return;
      const spec = getObjectType(obj.type);
      if (!spec || !spec.editableText) return;
      e.preventDefault();
      if (!canEdit(connectionStateRef.current)) return;
      startEdit(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, selection, objects, doc, startEdit]);

  // One rendered object per entry in the snapshot, whatever its type: the
  // registry decides which component draws it. A type this build does not know
  // is not drawn (its data survives untouched for the story that adds it).
  const renderedObjects = useMemo(
    () =>
      objects.map((obj: ObjectSnapshot) => {
        const spec = getObjectType(obj.type);
        if (!spec) return null;
        const Component = spec.Component;
        return (
          <Component
            key={obj.id}
            obj={obj}
            doc={doc}
            zoom={cam.zoom}
            selected={selectedIds.has(obj.id)}
            editing={obj.id === editingId}
            editable={editable}
            onObjectPointerDown={gesture.onObjectPointerDown}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onColor={onColor}
          />
        );
      }),
    // `editable` is a dependency so that a board which becomes uneditable (story 4)
    // actually re-renders its objects as read-only. The gesture's handlers are
    // stable, so it is deliberately not a dependency.
    [objects, doc, cam.zoom, selectedIds, editingId, editable, gesture.onObjectPointerDown, startEdit, endEdit, onColor],
  );

  return (
    // The history is reachable from inside the objects themselves (a sticky's text
    // editor needs it) without every object type having to accept an undo prop:
    // the provider is the board, and the objects are rendered by the registry.
    <UndoContext.Provider value={undoController}>
      <BoardViewportRoot
        api={api}
        rootRef={rootRef}
        onEmptyDoubleClick={onEmptyDoubleClick}
        onEmptyClick={onEmptyClick}
        marquee={marquee}
        tool={tool}
        onTextToolClick={onTextToolClick}
      >
        {renderedObjects}
      </BoardViewportRoot>

      {/* The two creation tools of story 10 are not hints about the cursor, they
          are the board's surface for as long as they are open: drawn above the
          objects, taking every press, so a drag that starts on a shape draws a new
          shape there instead of moving it, and no pan or marquee happens
          underneath. They are mounted only while they are the tool, and only on a
          board that can be edited - the hook guarantees both, and the conditions
          here are the same facts stated twice rather than a third gate. */}
      {editable && tool === 'shape' ? (
        <ShapeTool kind={shapeKind} camera={cam} doc={doc} onCreated={onToolCreated} />
      ) : null}
      {editable && tool === 'connector' ? (
        <ConnectorTool camera={cam} snapshot={objects} doc={doc} onCreated={onToolCreated} />
      ) : null}

      <ConnectionStatus state={board.connectionState} />

      <Toolbar
        onCreateSticky={onCreateSticky}
        disabled={!editable}
        undo={undoState}
        tool={tool}
        onTool={setTool}
        shapeKind={shapeKind}
        onShapeKind={setShapeKind}
      />

      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />

      <SharePanel boardId={boardId} connectionState={board.connectionState} />

      {/* Outlines and resize handles, drawn in screen pixels above the board. */}
      <SelectionOverlay
        ids={selectedIds}
        snapshot={objects}
        camera={cam}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />

      {/* "N selected" + Delete above the selection - or the note's own colour and
          delete toolbar when exactly one note is selected. */}
      <SelectionBar
        ids={selectedIds}
        snapshot={objects}
        camera={cam}
        editing={editingId !== null}
        onDelete={onDeleteSelection}
        onColor={(id: string, color: StickyColor) => onColor(id, color)}
        onTextSize={(id: string, size: TextSize) => onTextSize(id, size)}
        onShapeStyle={onShapeStyle}
      />
    </UndoContext.Provider>
  );
}
