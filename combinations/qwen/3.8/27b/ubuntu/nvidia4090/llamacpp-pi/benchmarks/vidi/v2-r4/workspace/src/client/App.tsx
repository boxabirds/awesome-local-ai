/**
 * Top-level layout for vidi6.
 *
 * The board fills the whole window. `Board` measures its pixel size
 * (synchronously, then via ResizeObserver) so camera maths always knows the
 * viewport, and shares the camera API with the board viewport.
 *
 * Story 2: the board document (in-memory Y.Doc) and the note list live here;
 * selection/editing is local state, the left toolbar creates notes at the
 * visible centre, double-clicks on empty space create notes at the click and
 * clicks on empty space clear the selection.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardViewport } from "./canvas/BoardViewport";
import { CameraContext, useCamera } from "./canvas/useCamera";
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  type Point,
  type Size,
  zoomPercent,
} from "./canvas/camera";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { installTestHooks } from "./canvas/testHooks";
import { Toolbar } from "./board/Toolbar";
import { useBoardDoc } from "./board/useBoardDoc";
import {
  usePruneSelection,
  useSelection,
  useStickyKeyboard,
} from "./board/useSelection";
import { StickyNote } from "./objects/StickyNote";
import { createSticky, snapshot } from "../shared/board-model";

function Board() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const api = useCamera(size);
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();

  // Render order must stay stable (creation order, then id): bringToFront
  // re-sorts the z-ordered snapshot, and moving a DOM node mid-drag would
  // release the active pointer capture. Stacking is expressed via CSS
  // z-index on each note instead of DOM order.
  const renderNotes = useMemo(
    () =>
      [...notes].sort((a, b) =>
        a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : 1,
      ),
    [notes],
  );

  usePruneSelection(notes, selection);
  useStickyKeyboard(doc, selection);

  /** Create a note centred at a world point; a successful create starts editing. */
  const createStickyAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id !== "") selection.startEdit(id);
    },
    [doc, selection.startEdit],
  );

  /** The left toolbar: a note in the centre of the *visible* area, wherever
   * the camera happens to be (not the world origin). */
  const createStickyAtCenter = useCallback(() => {
    createStickyAt(
      screenToWorld(api.camera, { x: size.width / 2, y: size.height / 2 }),
    );
  }, [createStickyAt, api.camera, size]);

  const getBoardSnapshot = useCallback(() => snapshot(doc), [doc]);

  // The board is full-window: track the actual pixel size of the container so
  // reset/step zoom can target the true centre. Camera x,y are intentionally
  // unchanged by resize (only the size is updated).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const { clientWidth, clientHeight } = el;
      setSize((prev) =>
        prev.width === clientWidth && prev.height === clientHeight
          ? prev
          : { width: clientWidth, height: clientHeight },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    installTestHooks(() => api.camera, api.setCamera, () => doc, getBoardSnapshot);
  }, [api.camera, api.setCamera, doc, getBoardSnapshot]);

  return (
    <div ref={containerRef} className="board-root">
      <CameraContext.Provider value={api}>
        <BoardViewport
          onCreateAt={createStickyAt}
          onEmptyClick={() => selection.select(null)}
        >
          {renderNotes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selection.select}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          ))}
        </BoardViewport>
      </CameraContext.Provider>
      <Toolbar onCreateSticky={createStickyAtCenter} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep("in")}
        onZoomOut={() => api.zoomStep("out")}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated && notes.length === 0} />
    </div>
  );
}

export function App() {
  return <Board />;
}
