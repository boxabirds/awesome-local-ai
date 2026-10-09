import { useCallback, useEffect, useRef } from "react";
import type * as Y from "yjs";
import { createSticky, deleteObject } from "../shared/board-model";
import { Toolbar } from "./board/Toolbar";
import { useBoardDoc } from "./board/useBoardDoc";
import { useSelection } from "./board/useSelection";
import { BoardViewport, CameraApiContext } from "./canvas/BoardViewport";
import type { Point } from "./canvas/camera";
import { screenToWorld } from "./canvas/camera";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { useCamera, useWindowSize } from "./canvas/useCamera";
import { StickyNote } from "./objects/StickyNote";

export interface AppProps {
  /** Render a board whose document is owned elsewhere (tests, later stories). */
  doc?: Y.Doc;
}

/**
 * Story 1: a full-window infinite board with pan, zoom and orientation cues.
 * Story 2: sticky notes on top of it.
 *
 * The camera lives here so the viewport, the zoom controls and the navigation
 * hint all share one instance; the document and the local selection are created
 * here too because the toolbars, the notes and the keyboard rules all drive them.
 */
export function App({ doc: providedDoc }: AppProps = {}) {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);
  const { doc, notes } = useBoardDoc(providedDoc);
  const selection = useSelection();

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const cameraRef = useRef(board);
  cameraRef.current = board;
  const sizeRef = useRef(viewportSize);
  sizeRef.current = viewportSize;

  /** Creates a centred yellow note at a world point and starts typing it. */
  const createAt = useCallback(
    (worldPoint: Point) => {
      const id = createSticky(doc, worldPoint);
      if (id === false) return;
      selectionRef.current.select(id);
      selectionRef.current.startEdit(id);
    },
    [doc],
  );

  /** Sticky note button: the centre of the visible board area, at any pan. */
  const createAtVisibleCentre = useCallback(() => {
    const centre = { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 };
    createAt(screenToWorld(cameraRef.current.camera, centre));
  }, [createAt]);

  // ---- keyboard rules ----------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // While typing, Delete / Backspace / Enter belong to the textarea.
      if (isEditableTarget(event.target)) return;
      if (selectionRef.current.editingId !== null) return;
      const selectedId = selectionRef.current.selectedId;
      if (!selectedId) return;

      if (event.key === "Enter") {
        event.preventDefault();
        selectionRef.current.startEdit(selectedId);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteObject(doc, selectedId);
        selectionRef.current.select(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc]);

  // A note removed by the bin button (or later by another client) must not stay
  // selected.
  useEffect(() => {
    const selectedId = selection.selectedId;
    if (selectedId && !notes.some((note) => note.id === selectedId)) selection.select(null);
  }, [notes, selection]);

  // Notes are rendered in a *stable* order (creation order) and stacked with CSS
  // `z-index` taken from the model's `z`. Moving DOM nodes mid-drag — which is
  // what sorting the DOM by z would do when `bringToFront` runs — makes the
  // browser release pointer capture and the drag dies, so stacking is done with
  // z-index instead of DOM order.
  const paintOrder = [...notes].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );

  return (
    <CameraApiContext.Provider value={board}>
      <BoardViewport doc={doc} selection={selection}>
        {paintOrder.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={board.camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtVisibleCentre} />
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
