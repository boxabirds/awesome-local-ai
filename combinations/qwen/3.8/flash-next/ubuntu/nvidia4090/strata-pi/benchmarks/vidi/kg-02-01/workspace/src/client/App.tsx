import { useCallback, useEffect } from "react";
import * as Y from "yjs";
import { BoardViewport, CameraApiContext } from "./canvas/BoardViewport";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { useCamera, useWindowSize } from "./canvas/useCamera";
import { worldToScreen, screenToWorld, type Point } from "./canvas/camera";
import { Toolbar } from "./board/Toolbar";
import { useSelection } from "./board/useSelection";
import { useBoardDoc } from "./board/useBoardDoc";
import { useBoardTestHooks } from "./board/boardTestHooks";
import { NoteToolbar } from "./objects/NoteToolbar";
import { StickyNote } from "./objects/StickyNote";
import { createSticky, deleteObject, setStickyColor } from "../shared/board-model";
import type { StickyColor } from "../shared/config";

/**
 * Story 2: notes live in a Yjs document that this component owns (in memory
 * only, until story 4 persists it and story 3 shares it), and selection,
 * editing and dragging are local UI state that is never written to it.
 *
 * `doc` is optional: passing one in lets component tests inspect the exact
 * document the UI mutates, and story 4 will pass a persisted document the same
 * way.
 */
export interface AppProps {
  doc?: Y.Doc;
}

/** Gap between the top of a note and its floating toolbar, in screen pixels. */
const NOTE_TOOLBAR_GAP = 44;

export function App({ doc }: AppProps = {}) {
  const viewportSize = useWindowSize();
  const camera = useCamera(viewportSize);
  const board = useBoardDoc(doc);
  const { selectedId, editingId, draggingId, select, startEdit, endEdit, setDragging } =
    useSelection();

  const boardDoc = board.doc;
  const cameraState = camera.camera;

  useBoardTestHooks(boardDoc);

  /** Create a note centred on a world point and start typing straight away. */
  const createAt = useCallback(
    (worldPoint: Point) => {
      const id = createSticky(boardDoc, worldPoint);
      if (!id) return;
      startEdit(id);
    },
    [boardDoc, startEdit],
  );

  /** Sticky note button: the centre of the visible board area, at any zoom. */
  const createFromToolbar = useCallback(() => {
    createAt(
      screenToWorld(cameraState, {
        x: viewportSize.width / 2,
        y: viewportSize.height / 2,
      }),
    );
  }, [createAt, cameraState, viewportSize]);

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (selectedId === null) return;
      // Only the colour changes: text, position, stacking and the selection
      // stay exactly as they were.
      setStickyColor(boardDoc, selectedId, color);
    },
    [boardDoc, selectedId],
  );

  const handleDelete = useCallback(() => {
    if (selectedId === null) return;
    deleteObject(boardDoc, selectedId);
    select(null);
  }, [boardDoc, select, selectedId]);

  // ---- keyboard: Enter edits, Delete/Backspace deletes ---------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // While a note's text has focus the keys belong to the text: Backspace
      // and Delete edit characters, they never remove the note.
      if (isEditableTarget(event.target)) return;

      if (event.key === "Enter") {
        if (selectedId === null || editingId !== null) return;
        event.preventDefault();
        startEdit(selectedId);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedId === null || editingId !== null) return;
        event.preventDefault();
        deleteObject(boardDoc, selectedId);
        select(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boardDoc, editingId, select, selectedId, startEdit]);

  const handleDragEnd = useCallback(
    () => setDragging(null),
    [setDragging],
  );

  const selectedNote = selectedId === null ? undefined : board.noteById(selectedId);
  /** The note toolbar is for a selected note only: never while dragging/editing. */
  const showNoteToolbar =
    selectedNote !== undefined && editingId === null && draggingId === null;

  const toolbarAnchor = selectedNote
    ? worldToScreen(cameraState, { x: selectedNote.x, y: selectedNote.y })
    : null;

  return (
    <CameraApiContext.Provider value={camera}>
      <BoardViewport onCreateSticky={createAt} onEmptyPointerUp={() => select(null)}>
        {board.notes.map((note) => {
          return (
            <StickyNote
              key={note.id}
              note={note}
              doc={boardDoc}
              zoom={cameraState.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
              onDragStart={setDragging}
              onDragEnd={handleDragEnd}
            />
          );
        })}
      </BoardViewport>

      <Toolbar onCreateSticky={createFromToolbar} />

      {showNoteToolbar && selectedNote && toolbarAnchor ? (
        <div
          className="note-toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{
            left: `${round(toolbarAnchor.x)}px`,
            top: `${round(toolbarAnchor.y - NOTE_TOOLBAR_GAP)}px`,
          }}
        >
          <NoteToolbar color={selectedNote.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      ) : null}

      <ZoomControls
        zoomPercent={camera.zoomPercent}
        canZoomIn={camera.canZoomIn}
        canZoomOut={camera.canZoomOut}
        onZoomIn={() => camera.zoomStep("in")}
        onZoomOut={() => camera.zoomStep("out")}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </CameraApiContext.Provider>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Keys must go to the text, not to the board, while the text has focus. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
