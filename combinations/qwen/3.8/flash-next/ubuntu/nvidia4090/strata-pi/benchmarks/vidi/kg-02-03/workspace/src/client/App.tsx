import { useCallback, useEffect, useMemo } from "react";
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

/**
 * Story 1 gave the board a camera; story 2 gives it something to put on it.
 *
 * The document, the local selection and the camera are created here and handed
 * down: the viewport creates notes on double-click, the left toolbar creates one
 * in the middle of the visible area, and notes edit, move, recolour and delete
 * themselves through `board-model`.
 */
export interface AppProps {
  /** Adopt an existing document instead of creating one (used by tests). */
  doc?: Y.Doc;
}

export function App({ doc: providedDoc }: AppProps) {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);
  const { doc, notes } = useBoardDoc(providedDoc);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // ---- creating notes -------------------------------------------------
  const createStickyAtScreen = useCallback(
    (screenPoint: Point) => {
      const world = screenToWorld(board.camera, screenPoint);
      // `createSticky` stores the top-left, so the point is the note's centre.
      const id = createSticky(doc, world);
      if (!id) return;
      startEdit(id);
    },
    [board.camera, doc, startEdit],
  );

  /** Sticky note button: the centre of the visible board area. */
  const createStickyInViewport = useCallback(() => {
    createStickyAtScreen({ x: viewportSize.width / 2, y: viewportSize.height / 2 });
  }, [createStickyAtScreen, viewportSize]);

  const clearSelection = useCallback(() => select(null), [select]);

  // ---- keyboard -------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // While editing, Delete/Backspace/Enter belong to the textarea.
      if (editingId !== null) return;
      if (isEditableTarget(event.target)) return;
      if (!selectedId) return;

      if (event.key === "Enter") {
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc, editingId, select, selectedId, startEdit]);

  // A note that disappears mid-interaction ends it silently (no dangling selection).
  useEffect(() => {
    if (!selectedId && !editingId) return;
    if (notes.some((note) => note.id === selectedId)) return;
    select(null);
  }, [editingId, notes, select, selectedId]);

  // Notes are rendered in a stable (id) order and stacked with CSS z-index.
  // Rendering them in z order would make `bringToFront` move their DOM nodes,
  // which browsers answer with lostpointercapture in the middle of a drag.
  const renderOrder = useMemo(
    () => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [notes],
  );

  return (
    <>
      <Toolbar onCreateSticky={createStickyInViewport} />
      <CameraApiContext.Provider value={board}>
        <BoardViewport onCreateAtScreen={createStickyAtScreen} onEmptyBoardClick={clearSelection}>
          {renderOrder.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={board.camera.zoom}
              selected={selectedId === note.id}
              editing={editingId === note.id}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          ))}
        </BoardViewport>
        <ZoomControls
          zoomPercent={board.zoomPercent}
          canZoomIn={board.canZoomIn}
          canZoomOut={board.canZoomOut}
          onZoomIn={() => board.zoomStep("in")}
          onZoomOut={() => board.zoomStep("out")}
          onReset={board.reset}
        />
        {/* Story 2 empty state: story 1's hint belongs to a board with no notes. */}
        <NavigationHint visible={notes.length === 0 && !board.hasNavigated} />
      </CameraApiContext.Provider>
    </>
  );
}

/** Delete/Backspace/Enter only reach the board when focus is not in a field. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
