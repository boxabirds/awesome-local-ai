import { useCallback, useEffect } from 'react';
import type { JSX } from 'react';

import { BoardViewport } from '../canvas/BoardViewport';
import { useBoard } from '../canvas/CameraProvider';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { publishConnection, publishConnectionState } from '../canvas/testHooks';
import { seedBoard, type SeedNote } from '../testSeed';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { useUndo, useUndoController } from './useUndo';
import type { UndoController } from './undo';
import { boundingBox, SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { MarqueeRect, useMarquee } from './Marquee';
import { NOTE_TOOLBAR_GAP_PX } from '../objects/NoteToolbar';
import type { StickyColor } from '../../shared/config';
import { canEdit } from './editable';
import { Toolbar } from './Toolbar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { getObjectType } from '../objects/registry';
import {
  createSticky,
  deleteObjects,
  isStickySnapshot,
  LOCAL_ORIGIN,
  setStickyColor,
} from '../../shared/board-model';
import type { Point } from '../canvas/camera';
// Registers the sticky note; the object components are reached through the
// registry, so this file says nothing about how any one type looks.
import '../objects/registry';

declare global {
  interface Window {
    /**
     * Test-only: mutate the board document as another client would.
     * `seed` is story 4's addition — a browser test that has to come back to a
     * board of a known size makes it here, through the real board model (see
     * `testSeed.ts`), so the notes it counts later left this client as real
     * Yjs updates and went through the room like any other change.
     */
    __vidi6Board?: {
      deleteNote(id: string): boolean;
      seed(notes: SeedNote[]): string[];
    };
  }
}

/**
 * Render order, never z order: restacking mid-gesture would make React move the
 * dragged element in the DOM, which drops pointer capture and kills the drag.
 * Stacking comes from each object's own `zIndex` style instead.
 */
function byCreation(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
}

export interface BoardContentsProps {
  /**
   * Board to sync with (`/api/rooms/<boardId>`); `null` stays offline. The board
   * page gets here only past the existence check, so an id that reaches this
   * component has already been answered "here" once (share.open_link).
   */
  boardId?: string | null;
  /** Use an existing document instead of owning one (component tests). */
  doc?: import('yjs').Doc;
  /**
   * Use an existing undo history instead of owning one (component tests, which
   * count the steps the board makes). One controller per board document either
   * way, and it is destroyed with the document (`undo.session_only`).
   */
  undo?: UndoController;
}

/**
 * Everything inside the camera context: the board document, this screen's
 * selection, the objects inside the viewport, and the three ways of changing
 * them — the pointer (a generic transform gesture), the keyboard, and the bar
 * above a selection.
 *
 * Story 7 moved the board from "notes and their interactions" to "objects and
 * their selection". Nothing here names a sticky note any more except where it
 * creates one (the toolbar's button) and where it colours one (the selection
 * bar's swatches): rendering, selecting, moving, resizing and deleting go through
 * the object type registry, so a story 9 type arrives to a board that already
 * knows how to do all five (`sel.all_types`).
 */
export function BoardContents({ boardId = null, doc, undo: given }: BoardContentsProps = {}): JSX.Element {
  const board = useBoard();
  const {
    doc: document,
    objects,
    connection,
    live,
  } = useBoardDoc(boardId, { doc });
  const selection = useSelection(objects);
  /** Every way this client can change the board, decided in one place. */
  const editable = canEdit(connection);
  const { camera } = board;

  // Story 8: what this person has done on this board, in this tab, and can take
  // back again. It hangs off the document rather than the address, because that
  // is where the transactions it watches live — and `BoardPage` is keyed by the
  // board id, so a link to another board replaces this component, its document
  // and its history together.
  const undo = useUndoController(document, given);
  const undoActions = useUndo(undo, editable);

  /** Start editing, if this board may be edited at all (TC-23). */
  const startEditing = useCallback(
    (id: string): void => {
      if (!editable) return;
      selection.startEdit(id);
    },
    [editable, selection],
  );

  /** One delete for the whole selection, then the selection lets go. */
  const deleteSelection = useCallback((): void => {
    if (!editable) return;
    // Bracketed by boundaries, so one click on the bar is one undo step and not
    // the first link in a chain of things that happened to be close together.
    undo.boundary();
    deleteObjects(document, [...selection.ids]);
    undo.boundary();
    selection.clear();
  }, [document, editable, selection, undo]);

  /** One recolour for the whole selection, in one update on the wire. */
  const recolourSelection = useCallback(
    (color: StickyColor): void => {
      if (!editable) return;
      const ids = [...selection.ids];
      undo.boundary();
      // `LOCAL_ORIGIN`, and not the default `null`: this batch is this client's
      // own change, and the history only watches for that origin. Left unnamed,
      // a recolour would be one more thing on the board this person could not
      // take back (`undo.only_own`, TC-15).
      document.transact(
        () => {
          for (const id of ids) setStickyColor(document, id, color);
        },
        LOCAL_ORIGIN,
      );
      undo.boundary();
    },
    [document, editable, selection, undo],
  );

  // The gesture, the marquee and the keys all act on the same selection, and all
  // read the board through `objects` — so an object deleted by somebody else
  // stops being dragged, and stops being nudged, on the same frame it vanishes.
  const gesture = useTransformGesture({
    doc: document,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // Story 8's use of story 7's hooks: a drag opens and closes an undo step, so
    // every frame it writes joins that one step and the gesture that follows it
    // does not (`undo.capture`, TC-14, TC-15, TC-17).
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });
  const marquee = useMarquee(camera, objects, useCallback(
    (ids: string[]): void => {
      selection.setMany(ids, true);
    },
    [selection],
  ));
  useBoardKeys({ doc: document, selection, snapshot: objects, canEdit: editable, undo });

  /** Create a note centred on a world point, selected and in edit mode. */
  const createAndEdit = useCallback(
    (world: Point): void => {
      // Double-click on empty board, and the Sticky note button: both create
      // nothing while the board could not be loaded (TC-23).
      if (!editable) return;
      undo.boundary();
      const id = createSticky(document, world);
      undo.boundary();
      if (typeof id !== 'string') return; // non-finite point: nothing happens
      startEditing(id);
    },
    [document, editable, startEditing, undo],
  );

  // A board that stops being editable also stops being *edited*: an object that
  // was open for typing closes, so the keystrokes that come after the bad news
  // have nowhere to go.
  const editingId = selection.editingId;
  useEffect(() => {
    if (!editable && editingId !== null) selection.endEdit();
  }, [editable, editingId, selection]);

  // Test-only hook, dropped from production builds: lets e2e tests delete a
  // note behind the client's back, as a collaborator would (stale
  // interactions, TC-37; there is no second client until story 3).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    window.__vidi6Board = {
      deleteNote: (noteId: string) => deleteObjects(document, [noteId]) > 0,
      seed: (seeds: SeedNote[]) => seedBoard(document, seeds),
    };
    return () => {
      delete window.__vidi6Board;
    };
  }, [document]);

  // Test-only: the badge hides when things are normal, which is indistinguishable
  // from "has never connected" by looking at the DOM (TC-29 watches the state
  // itself while two boards sit idle).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    publishConnectionState(connection);
  }, [connection]);

  // Test-only: hand a test the means to cut this board's wire (TC-27). An
  // outage is more than the network being off: an established socket survives
  // that emulation, so the socket goes too and the retry then fails.
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    publishConnection(live);
    return () => publishConnection(null);
  }, [live]);

  // The selection's bounding box, in the screen pixels it is drawn in: the bar
  // hangs above it and the handles sit on its corners, and neither one grows when
  // the board is zoomed in (`sel.bar`, `sel.resize`).
  const box = boundingBox(selection.ids, objects);
  const topLeft = box ? worldToScreen(camera, { x: box.x, y: box.y }) : null;
  const anchorLeft = topLeft !== null && box !== null ? topLeft.x + (box.width * camera.zoom) / 2 : 0;
  const anchorTop = topLeft !== null ? topLeft.y - NOTE_TOOLBAR_GAP_PX : 0;
  // The selection bar's toolbar variant needs the colour of the one note it is
  // about; a selection of more than one note has no single colour to show.
  const lone = selection.ids.size === 1 ? objects.find((object) => selection.ids.has(object.id)) : undefined;

  return (
    <>
      <BoardViewport
        onEmptySpaceClick={selection.clear}
        onEmptySpaceDoubleClick={createAndEdit}
        marquee={marquee}
        overlay={
          <>
            <SelectionOverlay
              ids={selection.ids}
              snapshot={objects}
              camera={camera}
              editable={editable}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
            {box && !selection.editingId ? (
              <div
                className="selection-anchor"
                data-testid="selection-anchor"
                style={{ left: `${anchorLeft}px`, top: `${anchorTop}px` }}
              >
                <SelectionBar
                  ids={selection.ids}
                  snapshot={objects}
                  editable={editable}
                  dragging={gesture.dragging}
                  color={lone && isStickySnapshot(lone) ? lone.color : undefined}
                  onColor={recolourSelection}
                  onDelete={deleteSelection}
                />
              </div>
            ) : null}
            <MarqueeRect rect={marquee.rect} camera={camera} />
          </>
        }
      >
        {objects
          .slice()
          .sort(byCreation)
          .map((object) => {
            // Objects of a type this build cannot draw are left out: their data
            // stays in the document, untouched, and their absence is visible in
            // what cannot be selected.
            const spec = getObjectType(object.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={object.id}
                object={object}
                doc={document}
                zoom={camera.zoom}
                selected={selection.ids.has(object.id)}
                editing={selection.editingId === object.id}
                editable={editable}
                dragging={gesture.draggingIds.has(object.id)}
                undo={undo}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onStartEdit={startEditing}
                onEndEdit={(next) => {
                  // Typing ends; a press outside the object lets go of it too.
                  if (next === 'unselected') selection.clear();
                  else selection.endEdit();
                }}
              />
            );
          })}
      </BoardViewport>
      {/* Top centre, above every state of the board (live.status). It never
          covers a control and never disables one. */}
      <ConnectionStatus state={connection} />
      <Toolbar
        disabled={!editable}
        undo={undoActions}
        onCreateSticky={() => {
          // Centre of the visible board area, wherever the board is panned
          // (sticky.create_button, TC-34).
          const centre: Point = {
            x: board.viewport.width / 2,
            y: board.viewport.height / 2,
          };
          createAndEdit(screenToWorld(camera, centre));
        }}
      />
    </>
  );
}
