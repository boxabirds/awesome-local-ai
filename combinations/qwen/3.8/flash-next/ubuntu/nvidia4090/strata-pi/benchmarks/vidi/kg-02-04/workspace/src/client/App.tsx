import { useCallback, useEffect, useRef } from "react";
import { BoardViewport, CameraApiContext } from "./canvas/BoardViewport";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { screenToWorld, type Point } from "./canvas/camera";
import { useCamera, useWindowSize } from "./canvas/useCamera";
import { Toolbar } from "./board/Toolbar";
import { useBoardDoc } from "./board/useBoardDoc";
import { useSelection } from "./board/useSelection";
import { StickyNote } from "./objects/StickyNote";
import { createSticky, deleteObject } from "../shared/board-model";

/**
 * The board: story 1's camera and navigation, story 2's sticky notes.
 *
 * `App` is the only place that holds selection and edit mode, because they are
 * board-wide rather than per note. The notes themselves come from the document.
 */
export function App() {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();

  const camera = board.camera;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const createStickyAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      // Creation never fails in this story, but a rejected creation must not
      // leave a phantom selection behind.
      if (id === null) return;
      selectionRef.current.select(id);
      selectionRef.current.startEdit(id);
    },
    [doc],
  );

  const createStickyAtCentre = useCallback(() => {
    // The centre of what the user currently sees, in world units.
    createStickyAt(screenToWorld(camera, { x: viewportSize.width / 2, y: viewportSize.height / 2 }));
  }, [createStickyAt, camera, viewportSize]);

  // ---- keyboard: Enter edits, Delete/Backspace deletes ---------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (isEditableTarget(target)) return;

      const current = selectionRef.current;
      if (current.editingId !== null) return; // inside the textarea, keys edit text

      if (event.key === "Enter") {
        if (current.selectedId === null) return;
        event.preventDefault();
        current.startEdit(current.selectedId);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (current.selectedId === null) return;
        event.preventDefault();
        deleteObject(doc, current.selectedId);
        current.select(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc]);

  // ---- a note that is gone cannot stay selected ---------------------------
  useEffect(() => {
    const selected = selectionRef.current.selectedId;
    if (selected === null) return;
    if (!notes.some((note) => note.id === selected)) selectionRef.current.select(null);
  }, [notes]);

  return (
    <CameraApiContext.Provider value={board}>
      <BoardViewport
        onCreateStickyAtPoint={createStickyAt}
        onEmptyBoardClick={() => selectionRef.current.select(null)}
      >
        {/* Board objects (story 2: sticky notes) render inside the world layer. */}
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyAtCentre} />
      <ZoomControls
        zoomPercent={board.zoomPercent}
        canZoomIn={board.canZoomIn}
        canZoomOut={board.canZoomOut}
        onZoomIn={() => board.zoomStep("in")}
        onZoomOut={() => board.zoomStep("out")}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated && notes.length === 0} />
    </CameraApiContext.Provider>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
