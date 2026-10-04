import { useCallback, useEffect, useRef, useState } from 'react';
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
import { getObjectType } from './objects/registry';
import { createSticky, deleteObjects } from '../shared/board-model';

function initialViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Nobody's selection: the set a board is drawn with before anybody has pressed anything. */
const NO_OBJECTS_TRANSFORMED: ReadonlySet<string> = new Set<string>();

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
  const selection = useSelection(notes);
  const editable = canEdit(connection);
  // One undo history for this document, and the button state that reads it.
  const undoHistory = useUndoHistory(doc);
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
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onKeyDown]);

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
    <div className="app" data-testid="app">
      <BoardViewport
        camera={camera}
        viewport={viewport}
        input={input}
        onViewportResize={handleResize}
        onEmptyDoubleClick={handleEmptyDoubleClick}
        onEmptyClick={handleEmptyClick}
        marquee={marquee}
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
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        onDelete={deleteSelection}
        canEdit={editable}
      />
      <Toolbar onCreateSticky={handleCreateSticky} canEdit={editable} undo={undoState} />
      <ConnectionStatus state={connection} />
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
  );
}
