import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useActiveTool, type ToolId } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { BoardProvider, type BoardServices } from './board/BoardContext';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useBoardKeys, isTextEntryTarget } from './board/useBoardKeys';
import { useUndo, useUndoHistory } from './board/useUndo';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { useTransformGesture } from './board/useTransformGesture';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useImageInsert } from './images/useImageInsert';
import { DropHighlight } from './images/DropHighlight';
import { Toast } from './ui/Toast';
import type { FilesDragHandlers } from './canvas/BoardViewport';
import { getObjectType } from './objects/registry';
import { applyTextSize } from './objects/TextObject';
import { createCanvasMeasurer } from './objects/textLayout';
import { createSticky, deleteObjects } from '../shared/board-model';
import { createText } from '../shared/objects/text';
import { setShapeStyle } from '../shared/objects/shape';
import { boardRects } from '../shared/objects/connector';
import type { FillColor, StrokeColor } from '../shared/config';
import { TEXT_FONT_FAMILY, type TextSize } from '../shared/config';

function initialViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Nobody's selection: the set a board is drawn with before anybody has pressed anything. */
const NO_OBJECTS_TRANSFORMED: ReadonlySet<string> = new Set<string>();

/**
 * The tools that are asked for rather than armed.
 *
 * One for now, and it is here rather than inside the hook because the hook is deliberately not in on the
 * subject: `useActiveTool` knows that an action tool does not hold the pointer, and does not know that the
 * Image tool is one of them.
 */
const ACTION_TOOLS: readonly ToolId[] = ['image'];

export interface AppProps {
  /**
   * The board to show, as named by the address. Left out, the document is not connected to a
   * room at all - which is what a component test does with a document of its own, and what
   * happens on an address that names no board.
   */
  boardId?: string;
  /**
   * Board document to render. Left out in production, where the app owns one; tests pass
   * a document they can read and drive directly, which is also how story 3's two-peer test
   * and story 4's loaded board will be mounted.
   */
  doc?: Y.Doc;
}

/**
 * Whether the user may write to the board in this connection state.
 *
 * Everything except `load_failed` leaves the board editable, including a connection that is
 * down: those edits go into the local document and reach the room when the connection does.
 * `load_failed` is different in kind - the room could not read the board, so what is on screen
 * is not known to be anybody's board, and an edit made on it would be built on a state nobody
 * can vouch for. That is why this one state stops the tools instead of merely explaining itself.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * Top-level layout: the infinite board fills the window, the tools are docked top-left, the
 * selection bar top-centre, the zoom control in the bottom-right corner and the first-use hint
 * near the bottom centre.
 *
 * Wiring follows from there being one source of truth: the document. Double-click and the
 * toolbar button add objects through the board model, objects re-render from the snapshot the
 * document gives them, and nothing here holds a copy of an object.
 *
 * Story 7 added the second half of that sentence: what is *selected* is held here, in local
 * state, and never written to the document - because two people working on one board are each
 * choosing what to work on, and a selection that travelled would be one person's mouse moving
 * somebody else's outlines. Everything the selection does - the marquee, the drag, the handles,
 * the Delete key - goes through the board model as a group operation, so nine selected objects
 * move, resize and disappear as one change to one document.
 *
 * Story 8 adds the history of those operations, and it is one per document: this person's undo
 * stack, in this tab, over this document. Everything that writes through the board model is
 * remembered by it, everything that arrives from anyone else is not, and the places where an
 * action begins and ends - a drag, a spell of typing - say so to it. That is why the controller is
 * made here, next to the document, and handed down rather than being made by whatever object
 * happens to be on screen: nine notes dragged at once are one action, and no note can know that.
 */
export function App({ boardId, doc: injectedDoc }: AppProps = {}): JSX.Element {
  const [viewport, setViewport] = useState<Size>(initialViewport);
  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, gesture, zoomStep, reset } =
    useCamera(viewport);
  const { doc, notes, connection } = useBoardDoc(boardId, injectedDoc);
  // Who this person is, as the board records it: this document's own id, which is the closest this product
  // has to a name until story 6 arrives with one. Made once per document, because it is the same string for
  // every object and every upload on the board, and because an image written by this tab has to be
  // recognisable as such by the tab itself.
  const identityId = useMemo(() => String(doc.clientID), [doc]);
  const selection = useSelection(notes);
  const editable = canEdit(connection);
  // Which tool this person's pointer is: pointing at things, or writing on them - and, for the
  // Shape tool, which of the three shapes it is about to write.
  const selectOne = useCallback(
    (id: string): void => {
      // The new object is the whole selection: the same reasoning the sticky note's birth uses, and
      // the reason a tool hands its id back to the board instead of selecting things for itself.
      selection.setMany([id], false);
    },
    [selection],
  );
  // One undo history for this document, and the button state that reads it.
  const undoHistory = useUndoHistory(doc);
  /**
   * Pictures, added.
   *
   * Made here because everything it needs is here and nothing else has all of it: the document to write
   * into, the board whose address the bytes are posted to, the camera that turns a drop into a place, the
   * connection that decides whether any of that is possible, and the history that makes one dropped batch
   * one thing to undo. It is one hook for the three ways in - drag, paste, picker - because the rules they
   * obey are the same rules, and three copies of them is three chances to disagree.
   *
   * The batch becomes the selection, the same way a drawn shape does: what a person just added is what they
   * are about to move or resize, and handles that are already there are handles nobody has to go and find.
   */
  const images = useImageInsert({
    doc,
    boardId,
    camera,
    connection,
    identityId,
    viewport,
    undo: undoHistory,
    onAdded: (ids: string[]): void => {
      selection.setMany(ids, false);
    },
  });
  const dragHandlers = useMemo<FilesDragHandlers>(
    () => ({
      onDragEnter: images.onDragEnter,
      onDragOver: images.onDragOver,
      onDragLeave: images.onDragLeave,
      onDrop: images.onDrop,
    }),
    [images.onDragEnter, images.onDragLeave, images.onDragOver, images.onDrop],
  );
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    // The keys stand down while a caret is somewhere on the board, which is the rule the board's
    // other keys already keep: one letter, one answer, and the text gets it first.
    editing: selection.editingId !== null,
    onSelect: selectOne,
    // I does not arm a tool; it asks for a file, and the pointer keeps meaning what it meant before.
    actionTools: ACTION_TOOLS,
    onActionTool: images.openPicker,
  });
  // What the pen is set to draw with. Kept here, next to the tool that uses it, because it is the
  // board's session rather than the toolbar's: the strokes already on the board were drawn with the
  // colour and width they were drawn with, and changing a swatch changes only the next one.
  const pen = usePenOptions();
  // The canvas the board's own text measurements are taken against - the ones asked for from the
  // board rather than from inside a text object, which is where a size change or a fresh heading's
  // first box is measured.
  const textMeasurer = useMemo(() => createCanvasMeasurer(TEXT_FONT_FAMILY), []);
  const undoState = useUndo(undoHistory, editable);
  // Which objects a gesture is carrying, so each one can say so while it lasts.
  const [transformed, setTransformed] = useState<ReadonlySet<string>>(NO_OBJECTS_TRANSFORMED);

  // The editable flag is read inside callbacks and window listeners that are not rebuilt when it
  // changes, so they read it from a ref rather than from a copy taken when they were made.
  const canEditRef = useRef(editable);
  useEffect(() => {
    canEditRef.current = editable;
  });

  // The camera is needed inside event handlers that are attached to the window.
  const cameraRef = useRef<Camera>(camera);
  useEffect(() => {
    cameraRef.current = camera;
  });

  const handleResize = useCallback((size: Size): void => {
    setViewport((current) =>
      current.width === size.width && current.height === size.height ? current : size,
    );
  }, []);

  const input = { beginPan, panMove, endPan, wheel, gesture, zoomStep, reset };

  /** Add a note at a point of the board and start typing it straight away. */
  const createAt = useCallback(
    (world: Point): void => {
      if (!canEditRef.current) {
        return;
      }
      // The note appearing is one step; what is typed into it afterwards is another. The editor
      // says the same thing when it opens, and one of the two is enough - but saying it at both
      // ends of a write is what makes each call here one step, whatever else happens around it.
      undoHistory.boundary();
      const id = createSticky(doc, world);
      undoHistory.boundary();
      if (id !== '') {
        // The new note is the selection, and the thing being typed into. Replacing the selection
        // rather than adding to it is deliberate: nine notes selected and a double-click on the
        // board should not put the tenth note in the middle of a group of nine.
        selection.setMany([id], false);
        selection.startEdit(id);
      }
    },
    [doc, selection, undoHistory],
  );

  /**
   * Write a heading, a caption, a sentence at a point of the board, and hand the pointer straight
   * back to the person's fingers: the Text tool's whole job is to put one object down and get out of
   * the way, so a second click is a second heading rather than a first one that never came.
   *
   * The object is made empty and is typed into immediately, which is the same order a note is born
   * in, and it means the same thing here: a text object nobody typed into is removed when the
   * editing stops, so clicking the board and then clicking away leaves a board with nothing new on
   * it. Who made it is recorded as this client, which is the closest this product has to a name till
   * story 6 arrives with one.
   */
  const createTextAt = useCallback(
    (world: Point): void => {
      if (!canEditRef.current) {
        return;
      }
      undoHistory.boundary();
      const id = createText(doc, world, String(doc.clientID));
      undoHistory.boundary();
      if (id !== null) {
        // The heading is the selection and the thing being typed into, and the tool that made it is
        // done with: `toolCreated` is the one call that says both, so the Text tool, the Shape tool
        // and the Connector tool all go back to Select the same way rather than three ways.
        toolCreated(id);
        selection.startEdit(id);
      }
    },
    [doc, selection, toolCreated, undoHistory],
  );

  /** Start typing a note - the one thing a board that could not be loaded will not do. */
  const requestEdit = useCallback(
    (id: string): void => {
      if (!canEditRef.current) {
        return;
      }
      selection.startEdit(id);
    },
    [selection],
  );

  /** Double-click on empty board space: a note appears under the pointer. */
  const handleEmptyDoubleClick = useCallback(
    (point: Point): void => {
      createAt(screenToWorld(cameraRef.current, point));
    },
    [createAt],
  );

  /** Toolbar button: a note appears in the middle of what the user is looking at. */
  const handleCreateSticky = useCallback((): void => {
    createAt(screenToWorld(cameraRef.current, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [createAt, viewport.height, viewport.width]);

  /** A click on empty board space deselects (editing has already ended by then). */
  const handleEmptyClick = useCallback((): void => {
    selection.clear();
  }, [selection]);

  /**
   * The Text tool's click: the board was pointed at, and what was pointed at is where the words go.
   * The point comes in as a place on the board area and is turned into world units here, which is
   * the same conversion a note's double-click goes through - one conversion, in one place, so that
   * two ways of putting something on the board cannot end up disagreeing about where the pointer was.
   */
  const handleTextPlace = useCallback(
    (point: Point): void => {
      createTextAt(screenToWorld(cameraRef.current, point));
    },
    [createTextAt],
  );

  /**
   * One of the four size buttons under a selected text object.
   *
   * The size and the box are one action, so the two boundaries are one step: a heading made large
   * and then undone with a single Ctrl+Z is what a person expects, and a step that only put the
   * letters back to Medium while leaving the box XL-tall is a box with nothing in it.
   */
  const handleTextSize = useCallback(
    (id: string, size: TextSize): void => {
      if (!canEditRef.current) {
        return;
      }
      undoHistory.boundary();
      applyTextSize(doc, id, size, textMeasurer);
      undoHistory.boundary();
    },
    [doc, textMeasurer, undoHistory],
  );

  /** Everything selected goes, in one transaction, and the selection goes with it. */
  const deleteSelection = useCallback((): void => {
    if (!editable) {
      return;
    }
    const ids = [...selection.ids];
    if (ids.length === 0) {
      return;
    }
    // One delete of nine notes is one step: the boundary before it stops it merging with whatever
    // moved those notes here, and the one after stops the next action merging into it.
    undoHistory.boundary();
    deleteObjects(doc, ids);
    undoHistory.boundary();
    selection.clear();
  }, [doc, editable, selection, undoHistory]);

  /** The marquee: a rectangle dragged over empty board space, selecting what is inside it. */
  const marquee = useMarquee({
    camera,
    objects: notes,
    onSelect: (ids, additive) => {
      selection.setMany(ids, additive);
    },
  });

  /** Moving and resizing, one object or a whole selection at a time. */
  const transform = useTransformGesture({
    doc,
    camera,
    snapshot: notes,
    selection,
    canEdit: editable,
    onTransformingChange: (ids) => {
      setTransformed(new Set(ids));
    },
    // A drag is one action however many frames it takes: sixty writes that belong to one movement
    // go back as one step, and the step ends when the pointer is let go - including when the
    // gesture is cancelled, which is a gesture that ended and must not leak into the next one.
    onGestureStart: undoHistory.boundary,
    onGestureEnd: undoHistory.boundary,
  });

  /** One of the eight swatches under a selected shape: the inside, or the outline, one of the two. */
  const handleShapeStyle = useCallback(
    (id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void => {
      if (!canEditRef.current) {
        return;
      }
      // A colour is one step, and one transaction: `setShapeStyle` writes whichever of the two was
      // asked for and leaves the label, the box and the stacking order where they were, and the two
      // boundaries keep it from merging into the drag that brought the shape here.
      undoHistory.boundary();
      setShapeStyle(doc, id, style);
      undoHistory.boundary();
    },
    [doc, undoHistory],
  );

  /**
   * What the board hands the things inside it that are not objects: the tools that draw a shape or
   * an arrow need the document, the right to write and the boxes of everything else, and none of
   * them is in the loop that draws objects, because none of them is an object.
   */
  const services: BoardServices = useMemo(
    () => ({
      doc,
      canEdit: editable,
      undo: undoHistory,
      objects: notes,
      rects: boardRects(notes),
      camera,
    }),
    [camera, doc, editable, notes, undoHistory],
  );

  /** Escape aborts a marquee if one is being dragged, and clears the selection otherwise. */
  const handleEscape = useCallback((): void => {
    if (marquee.rect !== null) {
      // The rectangle is what Escape is about while it is being dragged. What is left of the
      // selection is what was chosen before the drag started, and a person stopping a box
      // halfway has not asked to lose it.
      marquee.cancel();
      return;
    }
    selection.clear();
  }, [marquee, selection]);

  const onKeyDown = useBoardKeys({
    doc,
    objects: notes,
    selection,
    canEdit: editable,
    editing: selection.editingId !== null,
    onDeleteSelection: deleteSelection,
    onEscape: handleEscape,
    undo: undoHistory,
    // V, T and N. The tool goes through the same hook that holds it, because the rule about which
    // tools a board will accept belongs with the tool, not with whichever key was pressed.
    onTool: setTool,
    onCreateSticky: handleCreateSticky,
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onKeyDown]);

  // A paste on the window, which is where a paste goes when nothing in particular has the keyboard. The
  // hook decides what to do with it - a clipboard with no image files in it is left to the browser, and a
  // caret in a note's text is left to the note - and this is only the place it is listened for.
  useEffect(() => {
    const onPaste = (event: Event): void => {
      images.onPaste(event as ClipboardEvent);
    };
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
    };
  }, [images.onPaste]);

  // Enter and F2 edit the one selected note. This is the only keyboard action that belongs to a
  // single object rather than to the selection, which is why it stayed here rather than joining
  // the selection's commands.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTextEntryTarget(event.target) || selection.editingId !== null) {
        return;
      }
      if ((event.key === 'Enter' || event.key === 'F2') && selection.onlyId !== null) {
        if (canEditRef.current) {
          event.preventDefault();
          requestEdit(selection.onlyId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [requestEdit, selection.editingId, selection.onlyId]);

  return (
    <BoardProvider services={services}>
      <div className="app" data-testid="app">
      <BoardViewport
        camera={camera}
        viewport={viewport}
        input={input}
        onViewportResize={handleResize}
        onEmptyDoubleClick={handleEmptyDoubleClick}
        onEmptyClick={handleEmptyClick}
        marquee={marquee}
        tool={tool}
        onTextPlace={handleTextPlace}
        filesDrag={dragHandlers}
      >
        {notes.map((object) => {
          // An object of a type this client has no component for is skipped: the board shows
          // what it knows how to draw, and a document from the future is not an error.
          const type = getObjectType(object.type);
          if (type === undefined) {
            return null;
          }
          const Component = type.Component;
          return (
            <Component
              key={object.id}
              object={object}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(object.id)}
              editing={selection.editingId === object.id}
              transforming={transformed.has(object.id)}
              canEdit={editable}
              identityId={identityId}
              progress={images.progress.get(object.id)}
              canRetry={images.canRetry(object.id)}
              onRetry={images.retry}
              onObjectPointerDown={transform.onObjectPointerDown}
              onObjectLostPointerCapture={transform.onObjectLostPointerCapture}
              onStartEdit={requestEdit}
              onEndEdit={selection.endEdit}
              undo={undoHistory}
            />
          );
        })}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={notes}
          camera={camera}
          onHandlePointerDown={transform.onHandlePointerDown}
        />
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      {tool === 'shape' ? (
        // The two tools that draw something are mounted only while they are up, and draw in screen
        // space rather than on the board: a dashed box that is the size of the drag, not a shape that
        // is not there yet. Mounted and unmounted with the tool because that is what makes Escape drop
        // an unfinished drag - the component goes away, and the drag it was holding goes with it.
        <ShapeTool kind={shapeKind} camera={camera} onCreated={toolCreated} />
      ) : null}
      {tool === 'connector' ? (
        <ConnectorTool camera={camera} snapshot={notes} onCreated={toolCreated} />
      ) : null}
      {tool === 'pen' ? (
        // The pen, and the two choices that go with it. Mounted and unmounted with the tool for the
        // reason the other two are: unmounting is what makes Escape drop the stroke in progress.
        // Unlike them it is handed no `onCreated` - a finished stroke leaves the pen up, because
        // nobody draws exactly one stroke - and it is handed the document and this client's id, which
        // is who the stroke is signed by.
        <>
          <PenTool
            camera={camera}
            color={pen.color}
            thickness={pen.thickness}
            doc={doc}
            identityId={String(doc.clientID)}
          />
          <PenToolbar
            color={pen.color}
            thickness={pen.thickness}
            onColor={pen.setColor}
            onThickness={pen.setThickness}
          />
        </>
      ) : null}
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        onDelete={deleteSelection}
        canEdit={editable}
        editingId={selection.editingId}
        onTextSize={handleTextSize}
        onShapeStyle={handleShapeStyle}
      />
      <Toolbar
        onCreateSticky={handleCreateSticky}
        canEdit={editable}
        undo={undoState}
        tool={tool}
        onTool={setTool}
        shapeKind={shapeKind}
        onShapeKind={(kind) => {
          // Choosing the kind is also asking for the tool that draws it: nobody picks "ellipse" in
          // order to then go and press the Shape button.
          setShapeKind(kind);
          setTool('shape');
        }}
        onImage={images.openPicker}
      />
      <ConnectionStatus state={connection} />
      <DropHighlight visible={images.highlight} />
      <Toast message={images.message} onDismiss={images.dismissMessage} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          zoomStep('in');
        }}
        onZoomOut={() => {
          zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      </div>
    </BoardProvider>
  );
}
