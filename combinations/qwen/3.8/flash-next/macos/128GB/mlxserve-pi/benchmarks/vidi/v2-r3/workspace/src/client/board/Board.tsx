import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { newBoardId } from '../../shared/board-id';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from '../canvas/camera';
import { useBoardDoc } from './useBoardDoc';
import { useUndo, useUndoController } from './useUndo';
import { useSelection } from './useSelection';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { useMarquee, MarqueeRect } from './Marquee';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import type { ConnectionState } from '../sync/connectBoard';
import { createSticky, deleteObjects, objectsInRect } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { reportConnectionState, setOutageHandler, setSeedNotesHandler } from '../canvas/testHooks';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { WebsocketProvider } from 'y-websocket';

export interface BoardProps {
  /**
   * Test seam: hands the board's Y.Doc to the caller once, so component
   * tests can create and delete notes through the model while the app keeps
   * rendering them. Unused by the app itself.
   */
  onDocReady?(doc: Y.Doc): void;
  /**
   * The board to open, instead of the one the address names. Only a test needs
   * it: two component tests on one page would otherwise share a board.
   */
  boardId?: string;
  /**
   * Test seam (story 4, TC-23): the live provider, so a component test can
   * emit a close event and drive the app into `load_failed`.
   */
  onProviderReady?(provider: WebsocketProvider): void;
}

/**
 * Whether the board can be edited from a connection state. False only for
 * `load_failed` — a board whose stored state could not be read must not be
 * written, because what a person would be editing is not what is really there.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * Top-level layout and wiring. The camera lives in useCamera (story 1); the
 * notes live in a Y.Doc owned by useBoardDoc (stories 3 and 4 will sync and
 * persist that same document); which notes are selected or edited is local
 * interaction state and is never written to the document.
 */
export function Board(props: BoardProps = {}): JSX.Element {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);
  const { camera } = cam;
  const [boardId] = useState(() => props.boardId ?? newBoardId());

  const { doc, notes, connection, emulateOutage } = useBoardDoc(boardId, props.onProviderReady);
  const selection = useSelection(notes);

  const editable = canEdit(connection);

  // This person's own undo history, for as long as this board is open: created
  // with its document and thrown away with it, so a reload begins empty again.
  const undoController = useUndoController(doc);
  const undo = useUndo(undoController, editable);

  // A test build lets the test take this board's link down.
  useEffect(() => {
    setOutageHandler((ms: number) => emulateOutage(ms));
  }, [emulateOutage]);

  // The connection state a test can read as well as see.
  useEffect(() => {
    reportConnectionState(connection);
  }, [connection]);

  // The board renders notes in stable order (by id) so CSS z-index does the
  // stacking. Reordering keyed children would move the dragged note's DOM node
  // out of the document, which drops pointer capture and kills the drag.
  const rendered = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [notes]);

  const { onDocReady } = props;
  useEffect(() => {
    if (onDocReady !== undefined) onDocReady(doc);
  }, [doc, onDocReady]);

  // A test build can fill this board to its tested size in one transaction.
  useEffect(() => {
    setSeedNotesHandler((count: number) => {
      const stride = 260;
      const columns = Math.ceil(Math.sqrt(count));
      doc.transact(() => {
        for (let i = 0; i < count; i++) {
          createSticky(doc, { x: (i % columns) * stride, y: Math.floor(i / columns) * stride });
        }
      });
    });
  }, [doc]);
  /** Create a note centred on a world point and start typing straight away. */
  const createAt = (world: Point): void => {
    if (!editable) return;
    // Its own undo step, on both sides: neither the action before it nor the
    // first drag of the new note is merged into the act of creating it.
    undoController.boundary();
    const id = createSticky(doc, world);
    undoController.boundary();
    if (id !== '') selection.startEdit(id);
  };

  const createAtViewportCentre = (): void => {
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  };

  // Marquee selection
  const marqueeSelect = useCallback((ids: string[]) => {
    if (ids.length > 0) {
      selection.setMany(ids, true);
    }
  }, [selection]);

  const marqueeObjectsInRect = useCallback((rect: Rect): string[] => {
    return objectsInRect(notes, rect);
  }, [notes]);

  const marquee = useMarquee(camera, marqueeSelect, marqueeObjectsInRect);

  // Transform gesture (group move + resize handles). Both ends of a gesture
  // close an undo step, so the whole drag — every frame of it, and the
  // bring-to-front that came with it — is one thing to undo, and a gesture that
  // was cancelled is still exactly one.
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: () => {
      undoController.boundary();
    },
    onGestureEnd: () => {
      undoController.boundary();
    },
  });

  // Board-wide keyboard commands (select all, clear, nudge, delete, undo, redo)
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undo: undoController,
  });

  // Enter key to edit the single selected sticky.
  // Use a ref so the keydown handler always sees the latest selection.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const sel = selectionRef.current;
      if (e.key === 'Enter') {
        const isText = e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement ||
          (e.target instanceof HTMLElement && e.target.isContentEditable);
        if (isText || sel.editingId !== null) return;
        if (sel.ids.size !== 1) return;
        const [onlyId] = sel.ids;
        e.preventDefault();
        sel.startEdit(onlyId);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app">
      <BoardViewport
        camera={camera}
        onViewportSize={setViewport}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onZoomAtPoint={cam.zoomAtPoint}
        onZoomStep={cam.zoomStep}
        onReset={cam.reset}
        onEmptyDblClick={(point) => {
          createAt(screenToWorld(camera, point));
        }}
        onEmptyClick={() => {
          selection.clear();
        }}
        onMarqueeBegin={(p) => marquee.begin(p)}
        onMarqueeMove={(p) => marquee.move(p)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
      >
        {rendered.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            canEdit={editable}
            onSelect={(id) => {
              selection.click(id);
            }}
            onToggle={(id) => {
              selection.toggle(id);
            }}
            onStartEdit={(id) => {
              selection.startEdit(id);
            }}
            onEndEdit={(next) => {
              selection.endEdit(next);
            }}
            onGesturePointerDown={(e, id) => gesture.onObjectPointerDown(e, id)}
            onGesturePointerMove={(e) => gesture.onPointerMove(e)}
            onGesturePointerUp={(e) => gesture.onPointerUp(e)}
            onGesturePointerCancel={(e) => gesture.onPointerCancel(e)}
            undo={undoController}
          />
        ))}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={(e, h) => gesture.onHandlePointerDown(e, h)}
      />
      <Toolbar
        onCreateSticky={createAtViewportCentre}
        disabled={!editable}
        undo={undo}
      />
      <SelectionBar
        ids={selection.ids}
        onDelete={() => {
          if (!editable) return;
          // One step of mine, closed on both sides of it.
          undoController.boundary();
          deleteObjects(doc, [...selection.ids]);
          undoController.boundary();
          selection.clear();
        }}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <ConnectionStatus state={connection} />
    </div>
  );
}
