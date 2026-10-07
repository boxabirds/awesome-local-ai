/**
 * The board surface (stories 1-4): the board a person looks at.
 *
 * It moved out of `App.tsx` when story 5 made the address bar something with routes in
 * it, and it stayed what it always was: a surface, not a page. It does not know how its
 * board id arrived - a link, a click on **New board**, the Back button - and it does not
 * ask whether that board exists. Asking is the page above it (`BoardPage`), which puts
 * this on the screen only once the board is known to be there, and which hangs the Share
 * panel beside it. What is left here is the job that has not changed since story 1:
 * connect to the room that owns this id, and draw what comes back.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { JSX } from 'react';

import { Toolbar } from './Toolbar.js';
import { useActiveTool } from '../tools/useActiveTool.js';
import { ShapeTool } from '../tools/ShapeTool.js';
import { ConnectorTool } from '../tools/ConnectorTool.js';
import { PenTool } from '../tools/PenTool.js';
import { PenToolbar } from '../tools/PenToolbar.js';
import { usePenOptions } from '../tools/usePenOptions.js';
import { useBoardDoc } from './useBoardDoc.js';
import type { BoardConnector } from './useBoardDoc.js';
import { useSelection } from './useSelection.js';
import { useTransformGesture } from './useTransformGesture.js';
import { useBoardKeys } from './useBoardKeys.js';
import { useUndo, useUndoController } from './useUndo.js';
import { useMarquee } from '../canvas/Marquee.js';
import { BoardViewport } from '../canvas/BoardViewport.js';
import { screenToWorld, viewportCentre } from '../canvas/camera.js';
import { NavigationHint } from '../canvas/NavigationHint.js';
import { ZoomControls } from '../canvas/ZoomControls.js';
import {
  CameraProvider,
  useCamera,
  useCameraContextValue,
  useViewportSize,
} from '../canvas/useCamera.js';
import { ConnectionStatus } from '../sync/ConnectionStatus.js';
import { canEdit } from '../sync/connectBoard.js';
import SelectionBar from '../objects/SelectionBar.js';
import SelectionOverlay from '../objects/SelectionOverlay.js';
import { getObjectType } from '../objects/registry.js';
import { remeasureTextBox } from '../objects/useTextBoxSync.js';
import { createSticky, deleteObjects, objectBounds, type ObjectSnapshot, type Rect } from '../../shared/board-model.js';
import { setTextSize, TEXT_TYPE, type TextSnapshot } from '../../shared/objects/text.js';
import { setShapeStyle, SHAPE_TYPE, type ShapeSnap } from '../../shared/objects/shape.js';
import type { FillColor, StrokeColor, TextSize } from '../../shared/config.js';

/**
 * Focus guard: a keyboard shortcut must not fire while the user is typing. Kept
 * here only for the `N` (new note) shortcut; the selection-wide shortcuts
 * (select-all, deselect, nudge, delete, Enter) live in `useBoardKeys`.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const name = target.tagName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || target.isContentEditable;
}

/**
 * Top-level layout: the board fills the window, the toolbar stands on its left
 * edge, the zoom controls sit in the bottom-right corner, the first-use hint at
 * the bottom centre and the connection badge at the top centre. The camera lives
 * here (one camera per visit, per device) and is shared with the board surface
 * through context; the board content lives in the `Y.Doc` that `useBoardDoc`
 * owns and shares with everyone else on this board.
 */
export function BoardSurface({ boardId, connect }: { boardId: string; connect?: BoardConnector }): JSX.Element {
  const viewport = useViewportSize();
  const api = useCamera(viewport);
  const context = useCameraContextValue(api, viewport);

  // The Y.Doc is the one place board content is kept: every note with its
  // position, colour, text and stacking order. Selection and editing are
  // deliberately *not* in it: what this user has selected is not board content,
  // and once the document is shared (story 3) writing it there would move other
  // people's selection.
  const { doc, notes, connection } = useBoardDoc(boardId, connect);
  // The selection is a set now (story 7). It is pruned internally whenever the
  // document changes, so a note a colleague deleted leaves it on its own.
  const selection = useSelection(notes);

  /**
   * Whether this board takes edits. One decision, made from the connection state
   * and handed to everything that could write: the toolbar button, the surface,
   * the notes, the shortcuts. A lock that was implemented per control would be a
   * lock with holes in it - the shortcut would work while the button was greyed
   * out, and a drag is a longer path than either.
   *
   * It is false for one state only, `load_failed`: a room that said it could not
   * open this board. A room that cannot be *reached* leaves the board editable,
   * because there the changes have somewhere to go as soon as the connection
   * comes back (see `canEdit`).
   */
  const editable = canEdit(connection);

  /**
   * This tab's own undo history, for as long as this board is open (story 8). It
   * belongs to the document rather than to any object, because the thing it
   * undoes is a change to the document: one history for notes, for the toolbar,
   * for the shortcuts and for story 16's comments, and one history *per person*,
   * because it never leaves this tab and only ever holds the transactions this
   * tab issued. Undoing here can no more take back a colleague's note than the
   * selection can.
   */
  const undoHistory = useUndoController(doc);
  const undo = useUndo(undoHistory, editable);

  /**
   * Which tool the pointer is set to (story 9, three more tools in story 10). Local
   * to this tab like the selection is, and pulled back to Select by itself the moment
   * the board stops taking edits - the same `editable` that greys the button out.
   * It owns the single-letter shortcuts, including Escape out of a tool, and
   * `toolCreated`, which is what puts a freshly drawn thing in the selection.
   */
  const tools = useActiveTool(selection, editable);

  /**
   * Which ink and which pen this tab's pen draws with (`pen.options`). Session state
   * beside the tool and the selection - not in the document, so a colleague choosing red
   * changes nothing here, and not in local storage either, so the pen that is picked up
   * is the pen that was picked up now rather than the one left down yesterday.
   */
  const pen = usePenOptions();

  // The tab says which board it is holding. This starts to matter the day boards have
  // links: a board gets shared, somebody ends up with three of them open, and a tab that
  // just says "vidi6" is a tab that gets the next pasted link in the wrong place. Restored
  // on the way out, because the page this board is standing on - home, or not found - has a
  // title of its own that outgives the board.
  useEffect(() => {
    const previous = document.title;
    document.title = `Board ${boardId} - vidi6`;
    return () => {
      document.title = previous;
    };
  }, [boardId]);

  /** Create a note centred on a world point, select it and open it for typing. */
  const createAt = useCallback(
    (x: number, y: number) => {
      if (!editable) return;
      // The creation is one undo step and the typing that opens up on the note
      // straight afterwards is the next one - otherwise a double-click that made a
      // note and typed in it would come back as a note that is empty but still on
      // the board.
      undoHistory.boundary();
      const id = createSticky(doc, { x, y });
      undoHistory.boundary();
      if (typeof id !== 'string') return;
      selection.startEdit(id);
    },
    [doc, editable, selection, undoHistory],
  );

  /** The Sticky note button and the `N` shortcut: the middle of what is visible. */
  const createInMiddleOfView = useCallback(() => {
    const centre = viewportCentre(viewport);
    const world = screenToWorld(api.camera, centre);
    createAt(world.x, world.y);
  }, [api.camera, createAt, viewport]);

  // The move/resize gesture and the marquee are board-level: one gesture acts on
  // the whole selection (Key decision 4), and a Shift+drag on empty space sweeps
  // objects into it (`sel.marquee`). Both read the same camera and notes the rest
  // of the board does.
  const transform = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    // A drag is one undo step: the window is closed before the gesture's first
    // write and after its last, so the frames in between - which are milliseconds
    // apart, and would otherwise merge with anything nearby - stay one movement.
    onGestureStart: undoHistory.boundary,
    onGestureEnd: undoHistory.boundary,
  });

  const addToSelection = useCallback(
    (ids: string[]) => selection.setMany(ids, true),
    [selection],
  );
  const marquee = useMarquee(api.camera, notes, addToSelection);

  // The shortcuts that act on the whole selection (select-all, deselect, nudge,
  // delete, Enter-to-edit). The tool keys (V, T, S, L) and Escape out of a tool
  // belong to `useActiveTool`, and `N` to the effect below, because it *makes*
  // something rather than acting on the selection.
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undo: undoHistory,
  });

  /**
   * The Text tool's click: the object is on the board, so the tool has answered its
   * one question and goes back to Select, and the new text is opened for typing -
   * which is the whole point of the tool, a cursor exactly where it was clicked.
   */
  const textCreated = useCallback(
    (id: string) => {
      tools.setTool('select');
      selection.startEdit(id);
    },
    [selection, tools],
  );

  /** Delete every selected object in one action, then clear the selection. */
  const deleteSelection = useCallback(() => {
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    undoHistory.boundary();
    deleteObjects(doc, ids);
    undoHistory.boundary();
    selection.clear();
  }, [doc, selection, undoHistory]);

  /**
   * The one selected object, when it is a text object: the selection bar then shows
   * that object's toolbar instead of a count of one. Everything else - nothing, a
   * note, a group - gets the bar it always got.
   */
  const soleText = useMemo<TextSnapshot | null>(() => {
    if (selection.ids.size !== 1) return null;
    const [id] = [...selection.ids];
    const object = notes.find((candidate) => candidate.id === id);
    return object !== undefined && object.type === TEXT_TYPE ? (object as TextSnapshot) : null;
  }, [notes, selection.ids]);

  /**
   * A click on a size button: the size, and the box the text needs at that size, are
   * one action. The measurement belongs between the two boundaries rather than after
   * them - a history entry that changed the letters without changing the space they
   * take would come back as text in a box of the wrong size.
   */
  const changeTextSize = useCallback(
    (size: TextSize) => {
      if (!editable || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoHistory.boundary();
      setTextSize(doc, id, size);
      remeasureTextBox(doc, id);
      undoHistory.boundary();
    },
    [doc, editable, selection.ids, undoHistory],
  );

  /**
   * Every object's live rectangle, computed once for the screen rather than once per
   * object. An arrow's geometry is a question about the two boxes it joins, the
   * selection outline is drawn from the same boxes, and both have to be the same
   * answer: an arrow whose end landed where the outline no longer was would be the
   * board disagreeing with itself.
   */
  const rects = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const object of notes) map.set(object.id, objectBounds(object));
    return map as ReadonlyMap<string, Rect>;
  }, [notes]);

  /**
   * The one selected object, when it is a shape: the selection bar then shows that
   * shape's colours instead of a count of one.
   */
  const soleShape = useMemo<ShapeSnap | null>(() => {
    if (selection.ids.size !== 1) return null;
    const [id] = [...selection.ids];
    const object = notes.find((candidate) => candidate.id === id);
    return object !== undefined && object.type === SHAPE_TYPE ? (object as ShapeSnap) : null;
  }, [notes, selection.ids]);

  /**
   * A click on a colour swatch: one field of one shape, one undo step. Nothing else
   * is asked of it - not a remeasure (a shape's box is its own, unlike text's), and
   * not a word about the selection, which is how a shape keeps the words somebody
   * else is typing into it.
   */
  const changeShapeStyle = useCallback(
    (style: { fill?: FillColor; stroke?: StrokeColor }) => {
      if (!editable || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoHistory.boundary();
      setShapeStyle(doc, id, style);
      undoHistory.boundary();
    },
    [doc, editable, selection.ids, undoHistory],
  );

  /**
   * The notes in a stable order, which is *not* the drawing order: they are drawn
   * by their `z` (a CSS stacking order), while the DOM keeps one element per note
   * in the order they were made. Reordering the elements every time a note is
   * brought to the front would move a node that has the pointer captured, which
   * ends the drag in the middle of a gesture - and it would throw away React's
   * state for a note the user is typing into.
   */
  const stackOrder = useMemo(
    () =>
      [...notes].sort(
        (a, b) =>
          a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    [notes],
  );

  // A note that is no longer in the document cannot stay selected or open for
  // editing; `useSelection` prunes its own set against the snapshot on every
  // document change, so there is nothing to do here.

  // The `N` shortcut creates a note at the centre of what is visible. It is the
  // only board shortcut left in this file because it *makes* something rather
  // than acting on the selection (which `useBoardKeys` owns). It never fires
  // while a text field has the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        createInMiddleOfView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createInMiddleOfView]);

  return (
    <div className="app" data-testid="app">
      <CameraProvider value={context}>
        <Toolbar
          onCreateSticky={createInMiddleOfView}
          tool={tools.tool}
          onTool={tools.setTool}
          shapeKind={tools.shapeKind}
          onShapeKind={tools.setShapeKind}
          canEdit={editable}
          undo={undo}
        />
        <BoardViewport
          doc={doc}
          canEdit={editable}
          marquee={marquee}
          tool={tools.tool}
          onTextCreated={textCreated}
          onStickyCreated={(id) => {
            selection.startEdit(id);
          }}
          onEmptyClick={() => {
            // Clicking empty board space selects nothing. While a note is being
            // edited its own editor ends the editing (and clears the selection),
            // so the note the user is typing into is never lost by a stray click.
            if (selection.editingId === null) selection.clear();
          }}
          // The pen's own screen, over the board and inside the surface: it must be the
          // first thing a pointer reaches and still leave the wheel to the board
          // (`pen.navigation`). The other drawing tools stand beside the surface; this
          // one cannot, and the difference is whether scrolling still works while the
          // tool is up.
          overlay={
            editable && tools.tool === 'pen' ? (
              <PenTool
                doc={doc}
                camera={api.camera}
                color={pen.color}
                thickness={pen.thickness}
                undo={undoHistory}
              />
            ) : undefined
          }
        >
          {stackOrder.map((note) => {
            // Draw each object through its type; a type this build cannot draw is
            // skipped, never rendered as something a drag could half-move.
            const spec = getObjectType(note.type);
            if (spec === undefined) return null;
            const Component = spec.Component;
            return (
              <Component
                key={note.id}
                object={note}
                doc={doc}
                zoom={api.camera.zoom}
                selected={selection.ids.has(note.id)}
                editing={selection.editingId === note.id}
                canEdit={editable}
                selectionSize={selection.ids.size}
                selection={selection}
                gesture={transform}
                undo={undoHistory}
                rects={rects}
                snapshot={notes as readonly ObjectSnapshot[]}
              />
            );
          })}
        </BoardViewport>
        {/* The tools that draw rather than click (story 10) stand between the board
            and its chrome: they own every pointer event over the board while they are
            up - which is what makes a shape drag that started on somebody's note
            never move that note - and they go away the moment they have made their
            one thing, or the board stopped taking edits. */}
        {editable && tools.tool === 'shape' ? (
          <ShapeTool
            doc={doc}
            kind={tools.shapeKind}
            camera={api.camera}
            undo={undoHistory}
            onCreated={tools.toolCreated}
          />
        ) : null}
        {editable && tools.tool === 'connector' ? (
          <ConnectorTool
            doc={doc}
            camera={api.camera}
            snapshot={notes}
            undo={undoHistory}
            onCreated={tools.toolCreated}
          />
        ) : null}
        {/* The pen's options, and the only toolbar in this app that is not the toolbar:
            six inks and three widths, shown while the pen is the tool and at no other
            time (`pen.options`). Choosing one changes what the *next* stroke is drawn
            with and reaches no further - there is no selection in this bar, and nothing
            here can find a stroke that is already on the board. */}
        {editable && tools.tool === 'pen' ? (
          <PenToolbar
            color={pen.color}
            thickness={pen.thickness}
            onColor={pen.setColor}
            onThickness={pen.setThickness}
          />
        ) : null}
        {/* Screen-space selection chrome: an outline per selected object plus
            resize handles around the whole selection, and a bar for a multi-
            selection. Fixed, so handles stay a constant 8 px at any zoom. */}
        <SelectionOverlay
          snapshot={notes}
          ids={selection.ids}
          onHandlePointerDown={transform.onHandlePointerDown}
        />
        <SelectionBar
          count={selection.ids.size}
          onDelete={deleteSelection}
          textSize={soleText?.size ?? null}
          onTextSize={changeTextSize}
          shape={soleShape}
          onShapeStyle={changeShapeStyle}
        />
      </CameraProvider>
      <ZoomControls
        zoomPercent={context.zoomPercent}
        canZoomIn={context.canZoomIn}
        canZoomOut={context.canZoomOut}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
      <ConnectionStatus state={connection} />
    </div>
  );
}
