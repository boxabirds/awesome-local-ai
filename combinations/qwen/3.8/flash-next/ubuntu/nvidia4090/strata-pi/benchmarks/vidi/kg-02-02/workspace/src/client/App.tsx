import { useCallback, useEffect, useRef } from "react";
import type * as Y from "yjs";
import { createSticky, deleteObject } from "../shared/board-model";
import { Toolbar } from "./board/Toolbar";
import { useBoardDoc } from "./board/useBoardDoc";
import { useSelection } from "./board/useSelection";
import { BoardViewport, CameraApiContext } from "./canvas/BoardViewport";
import { screenToWorld, type Point } from "./canvas/camera";
import { NavigationHint } from "./canvas/NavigationHint";
import { useCamera, useWindowSize } from "./canvas/useCamera";
import { ZoomControls } from "./canvas/ZoomControls";
import { StickyNote } from "./objects/StickyNote";

export interface AppProps {
  /**
   * Board document to render. Omitted in the app (the hook owns one); tests
   * pass a document they can inspect. Story 3 passes the document a network
   * provider is attached to.
   */
  doc?: Y.Doc;
}

/**
 * Story 2: sticky notes on the infinite board from story 1.
 *
 * The Y.Doc holds every note, `useSelection` holds what *this* client has
 * selected and is editing, and the board model owns every mutation. The camera
 * lives here so the viewport, the zoom controls and the navigation hint all
 * share one instance.
 */
export function App({ doc }: AppProps) {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);
  const { doc: document, notes } = useBoardDoc(doc);
  const selection = useSelection();

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const cameraRef = useRef(board.camera);
  cameraRef.current = board.camera;

  /** Creates a note centred on a world point and goes straight into editing. */
  const createAt = useCallback(
    (world: Point) => {
      const id = createSticky(document, world);
      if (id === false) return;
      const sel = selectionRef.current;
      sel.select(id);
      sel.startEdit(id);
    },
    [document],
  );

  /** sticky.create_button: a note in the middle of the visible board area. */
  const createInViewportCentre = useCallback(() => {
    const camera = cameraRef.current;
    createAt(screenToWorld(camera, { x: viewportSize.width / 2, y: viewportSize.height / 2 }));
  }, [createAt, viewportSize.width, viewportSize.height]);

  // ---- keyboard: Enter edits, Delete/Backspace deletes ----------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // While typing, Delete and Backspace belong to the textarea (TC-26).
      if (isEditableTarget(event.target)) return;

      const sel = selectionRef.current;
      const focused = noteIdOf(event.target);
      const targetId = focused ?? sel.selectedId;
      if (!targetId) return;
      if (sel.editingId !== null) return;

      if (event.key === "Enter") {
        event.preventDefault();
        sel.select(targetId);
        sel.startEdit(targetId);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteObject(document, targetId);
        sel.select(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [document]);

  // ---- a note that disappears also stops being selected or edited ----------
  useEffect(() => {
    const sel = selectionRef.current;
    const selectedId = sel.selectedId;
    if (selectedId === null) return;
    if (notes.some((note) => note.id === selectedId)) return;
    sel.select(null);
  }, [notes]);

  return (
    <CameraApiContext.Provider value={board}>
      <BoardViewport
        onEmptyDoubleClick={createAt}
        onEmptyClick={() => selectionRef.current.select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={document}
            zoom={board.camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={(id) => selectionRef.current.select(id)}
            onStartEdit={(id) => selectionRef.current.startEdit(id)}
            onEndEdit={(next) => selectionRef.current.endEdit(next)}
          />
        ))}
      </BoardViewport>

      <Toolbar onCreateSticky={createInViewportCentre} />
      <ZoomControls
        zoomPercent={board.zoomPercent}
        canZoomIn={board.canZoomIn}
        canZoomOut={board.canZoomOut}
        onZoomIn={() => board.zoomStep("in")}
        onZoomOut={() => board.zoomStep("out")}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated} />
    </CameraApiContext.Provider>
  );
}

function noteIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  const note = target.closest("[data-note-id]");
  return note?.getAttribute("data-note-id") ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
