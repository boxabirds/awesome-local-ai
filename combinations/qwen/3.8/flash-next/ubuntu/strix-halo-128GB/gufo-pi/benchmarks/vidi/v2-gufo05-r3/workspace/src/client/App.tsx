import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport, type BoardViewportApi } from './canvas/BoardViewport';
import type { Camera } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type EndEditTarget } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { MarqueeRect, useMarquee } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionAnnouncement, SelectionBar } from './board/SelectionBar';
import { UndoContext, useUndo, useUndoController } from './board/useUndo';
import { getObjectType } from './objects/registry';
import './objects/index';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { createSticky, deleteObjects, snapshot } from '../shared/board-model';
import { installBoardHook, reportConnectionState } from './canvas/testHooks';

export interface AppProps {
  /**
   * Board document to render. Omitted in production, where `useBoardDoc`
   * creates one; tests pass a document they can seed and assert on. A document
   * passed in from outside is kept local (no room connection), which is what
   * component tests need.
   */
  doc?: Y.Doc;
  /**
   * Board to connect to. Omitted in production when there is no board to open
   * (the Home and Board-not-found pages do not render the board at all); the
   * board page passes the id from the address bar (`/b/:boardId`).
   */
  boardId?: string;
}

/** The camera before the viewport has reported one, which is the default view. */
const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * The board: the document, the live connection, the local selection, the
 * toolbars and the board shortcuts, wired into the viewport. Story 5 moved the
 * routing (which board, or the home page, or Board not found) out of here and
 * into `router.ts`; `App` is now just the board, given an id to open. It stays
 * mounted only in the board page's `ready` state, where the board exists.
 *
 * Story 8 gave the board an undo history. It belongs to the person using this
 * tab, so `App` keeps exactly one controller for the board document, tells the
 * gestures, the text editor and the one-off commands where their steps begin and
 * end, and hands the toolbar whether there is anything left to step back to.
 */
export default function App({ doc, boardId }: AppProps = {}) {
  const { doc: boardDoc, notes, connection } = useBoardDoc(doc, boardId);
  /**
   * Read-only while the board's storage cannot be read: the things on screen are
   * whatever this tab happens to hold, so writing them would be a change the
   * service cannot keep. Looking, panning, zooming and selecting stay available.
   */
  const locked = !canEdit(connection);

  // --- Local UI state -------------------------------------------------------
  // A set, not one id: click replaces it, Shift+click and the marquee add to it,
  // and an object that disappears leaves it (the hook prunes stale ids).
  const selection = useSelection(notes);
  /** The viewport's camera, mirrored so screen-space controls can follow it. */
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const viewportApi = useRef<BoardViewportApi | null>(null);

  // --- Undo ---------------------------------------------------------------
  /**
   * One history per board document, alive while the board is on screen: the
   * steps in it are this tab's own changes and nothing else (`undo.own`).
   */
  const undoHistory = useUndoController(boardDoc);
  /** What the buttons show: whether there is anything of ours left to step. */
  const undoApi = useUndo(undoHistory, !locked);

  const deleteSelection = useCallback(() => {
    if (locked) return;
    // One Delete, however many objects it removed, is one undo step.
    undoHistory.boundary();
    deleteObjects(boardDoc, [...selection.ids]);
    undoHistory.boundary();
    selection.clear();
  }, [boardDoc, locked, selection, undoHistory]);

  // --- Gestures -------------------------------------------------------------
  const gesture = useTransformGesture({
    doc: boardDoc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !locked,
    // A press-to-release gesture is one step whatever happens in between, and
    // the next action starts a step of its own (`undo.boundaries`).
    onGestureStart: () => undoHistory.boundary(),
    onGestureEnd: () => undoHistory.boundary(),
  });

  // Shift+drag adds whatever is inside the rectangle to the selection; an empty
  // rectangle changes nothing at all.
  const addToSelection = useCallback((ids: string[]) => selection.setMany(ids, true), [selection]);
  const marquee = useMarquee(camera, notes, addToSelection);

  useBoardKeys({
    doc: boardDoc,
    selection,
    snapshot: notes,
    canEdit: !locked,
    // Escape cancels a marquee in flight before it cancels the selection.
    onEscape: () => {
      if (!marquee.rect) return false;
      marquee.cancel();
      return true;
    },
    undo: undoHistory,
  });

  const createStickyAtCentre = useCallback(() => {
    const centre = viewportApi.current?.viewportCentreWorld() ?? { x: 0, y: 0 };
    undoHistory.boundary();
    const id = createSticky(boardDoc, centre);
    undoHistory.boundary();
    if (id) {
      selection.click(id);
      selection.startEdit(id);
    }
  }, [boardDoc, selection, undoHistory]);

  /** A note created by double-click is selected and ready to type in. */
  const openForEditing = useCallback(
    (id: string) => {
      selection.click(id);
      selection.startEdit(id);
    },
    [selection],
  );

  /** Begin editing (`null`) or end it, keeping or dropping the selection. */
  const onEditChange = useCallback(
    (id: string, next: EndEditTarget | null) => {
      if (next === null) {
        // Opening the text editor changes the board, so a read-only board never
        // gets one (Escape and a click outside still close what is already open).
        if (!locked) selection.startEdit(id);
        return;
      }
      if (next === 'unselected') selection.clear();
      else selection.endEdit();
    },
    [locked, selection],
  );

  // Read-only board model and connection state for the e2e tests (test builds).
  useEffect(() => {
    installBoardHook(() => snapshot(boardDoc));
  }, [boardDoc]);
  useEffect(() => {
    reportConnectionState(connection);
  }, [connection]);

  // Painting order for the DOM: creation order, so a note never jumps around in
  // the tree while it is dragged (its `zIndex` does the stacking, see StickyNote).
  const paintOrder = useMemo(
    () =>
      [...notes].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
    [notes],
  );

  // A control would only be in the way while the selection is being moved or its
  // text is being typed; the live region behind it stays mounted so counts keep
  // being announced.
  const transforming = gesture.draggingIds.size > 0 || selection.editingId !== null;

  return (
    <UndoContext.Provider value={undoHistory}>
    <main className="app" data-testid="app-root">
      <ConnectionStatus state={connection} />
      {/* Spoken selection count: mounted for as long as the board is, because a
          live region that appears with the change is not announced. */}
      <SelectionAnnouncement count={selection.count} />
      <Toolbar onCreateSticky={createStickyAtCentre} undo={undoApi} locked={locked} />
      <BoardViewport
        doc={boardDoc}
        viewportApi={viewportApi}
        onStickyCreated={openForEditing}
        onClearSelection={() => selection.clear()}
        onCameraChange={setCamera}
        marquee={marquee}
        locked={locked}
        overlay={
          <>
            <SelectionOverlay
              ids={selection.ids}
              snapshot={notes}
              camera={camera}
              onHandlePointerDown={gesture.onHandlePointerDown}
            >
              <SelectionBar
                ids={selection.ids}
                snapshot={notes}
                doc={boardDoc}
                onDelete={deleteSelection}
                undo={undoHistory}
                locked={locked}
                hideControls={transforming}
              />
            </SelectionOverlay>
            <MarqueeRect rect={marquee.rect} camera={camera} />
          </>
        }
      >
        {paintOrder.map((note) => {
          // Every object is drawn by its registered type: the selection, marquee
          // and gesture code above know nothing about sticky notes.
          const objectType = getObjectType(note.type);
          if (!objectType) return null;
          return (
            <objectType.Component
              key={note.id}
              doc={boardDoc}
              snapshot={note}
              camera={camera}
              selection={{
                selected: selection.has(note.id),
                editing: selection.editingId === note.id,
                dragging: gesture.draggingIds.has(note.id),
              }}
              onEditChange={onEditChange}
              onObjectPointerDown={gesture.onObjectPointerDown}
            />
          );
        })}
      </BoardViewport>
    </main>
    </UndoContext.Provider>
  );
}
