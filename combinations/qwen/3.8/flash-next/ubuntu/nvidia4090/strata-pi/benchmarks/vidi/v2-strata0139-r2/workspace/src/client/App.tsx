import { useCallback, useEffect, useMemo, useRef } from "react";
import type * as Y from "yjs";
import { BoardViewport, CameraApiContext } from "./canvas/BoardViewport";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { useCamera, useWindowSize } from "./canvas/useCamera";
import type { Camera, Point as CameraPoint } from "./canvas/camera";
import { screenToWorld } from "./canvas/camera";
import { useBoardDoc } from "./board/useBoardDoc";
import { useSelection, type SelectionApi } from "./board/useSelection";
import { Toolbar } from "./board/Toolbar";
import { StickyNote } from "./objects/StickyNote";
import { ConnectionStatus } from "./sync/ConnectionStatus";
import { useConnectionTestHook } from "./sync/testHook";
import { createSticky, deleteObject, type StickySnapshot } from "../shared/board-model";

/**
 * The board: camera (story 1), the notes (story 2) and the live connection to
 * the room that holds them (story 3). The Y.Doc, the local selection and the
 * keyboard behaviour are wired here so the viewport, the toolbars and the notes
 * share one state.
 *
 * `doc` can be injected (component tests); `boardId` is the board this screen
 * connects to — without it the document stays local to this tab.
 */
export interface AppProps {
  doc?: Y.Doc;
  boardId?: string;
}

export function App({ doc: providedDoc, boardId }: AppProps = {}) {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);
  const { doc, notes, connectionState } = useBoardDoc({ doc: providedDoc, boardId });
  const selection = useSelection();

  useBoardKeys(doc, selection, notes);
  useConnectionTestHook(connectionState);

  const cameraRef = useRef<Camera>(board.camera);
  cameraRef.current = board.camera;

  /** Creates a note centred on a screen point and starts typing in it. */
  const createAtScreenPoint = useCallback(
    (point: CameraPoint) => {
      const world = screenToWorld(cameraRef.current, point);
      const id = createSticky(doc, world);
      if (typeof id !== "string") return;
      selection.startEdit(id);
    },
    [doc, selection],
  );

  /** The Sticky note tool: centred in the middle of the visible board area. */
  const createAtViewportCentre = useCallback(() => {
    const centre: CameraPoint = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    createAtScreenPoint(centre);
  }, [createAtScreenPoint, viewportSize.width, viewportSize.height]);

  const clearSelection = useCallback(() => selection.select(null), [selection]);

  // Notes are painted in a stable order (by id) and stacked with CSS z-index.
  // Re-sorting the React children whenever z changes would re-parent the note
  // being dragged, and removing an element from the document releases its
  // pointer capture: the drag would silently end halfway through.
  const paintOrder = useMemo(
    () => notes.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    [notes],
  );

  return (
    <CameraApiContext.Provider value={board}>
      <BoardViewport onCreateAtPoint={createAtScreenPoint} onEmptyClick={clearSelection}>
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

      <Toolbar onCreateSticky={createAtViewportCentre} />
      <ZoomControls
        zoomPercent={board.zoomPercent}
        canZoomIn={board.canZoomIn}
        canZoomOut={board.canZoomOut}
        onZoomIn={() => board.zoomStep("in")}
        onZoomOut={() => board.zoomStep("out")}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </CameraApiContext.Provider>
  );
}

/**
 * Board keyboard behaviour and selection hygiene.
 *
 * - Enter starts editing the selected note (never while editing, and never
 *   while typing in a field or pressing a button).
 * - Delete/Backspace delete the selected note when it is not being edited;
 *   while editing they reach the textarea and edit characters instead.
 * - A selection that points at a note that has gone is dropped, which is how
 *   the note toolbar's bin button and mid-drag deletions clear the selection.
 */
export function useBoardKeys(
  doc: Y.Doc,
  selection: SelectionApi,
  notes: readonly StickySnapshot[],
): void {
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const { selectedId, editingId } = selection;
    const exists = (id: string | null): boolean =>
      id === null || notes.some((note) => note.id === id);
    // Only a selection that points at a note which has gone is dropped.
    if (!exists(selectedId) || !exists(editingId)) selection.select(null);
  }, [selection, notes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (isEditableTarget(target)) return;

      const current = selectionRef.current;
      if (current.selectedId === null) return;
      // While a note is being edited the keys belong to the textarea.
      if (current.editingId !== null) return;

      if (event.key === "Enter") {
        // A focused button handles its own Enter.
        if (isButtonTarget(target)) return;
        event.preventDefault();
        current.startEdit(current.selectedId);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteObject(doc, current.selectedId);
        current.select(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.tagName === "BUTTON";
}
