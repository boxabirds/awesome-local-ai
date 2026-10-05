import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
  type Size,
} from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { registerTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type Selection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { isTypingTarget } from './objects/StickyTextEditor';
import { deleteObject, createSticky, type StickySnapshot } from '../shared/board-model';

/** The board fills the window; its size is the camera's viewport. */
const measureWindow = (): Size =>
  typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

/** Test handle: the pieces a component test needs to drive and inspect. */
export interface BoardHandle {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  selection: Selection;
}

export interface BoardProps {
  /** Overrides the measured window size (component tests pass a fixed size). */
  viewport?: Size;
  /** Filled in on every render; only used by tests. */
  handle?: { current: BoardHandle | null };
}

/**
 * The whole board: the infinite viewport from story 1, the left toolbar, the
 * sticky notes, the zoom control and the first-use hint, all sharing one camera,
 * one `Y.Doc` and one local selection.
 *
 * Keyboard shortcuts live here, on `window`: Enter starts editing the selected
 * note, Delete/Backspace deletes it — and both are ignored while a note is being
 * edited or focus is in a field, so those keys edit text instead.
 */
export function Board({ viewport: viewportProp, handle }: BoardProps = {}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<Size>(measureWindow);
  const viewport = viewportProp ?? measured;
  const controller = useCamera(viewport);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  if (handle) handle.current = { doc, notes, selection };

  // Viewport size from a ResizeObserver. A resize changes only the size: the
  // camera's x/y (world point at the top-left) stays put.
  useEffect(() => {
    if (viewportProp) return; // fixed size from the caller
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setMeasured((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportProp]);

  const { camera } = controller;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  /** Creates a note centred on a world point and starts typing in it right away.
   * Used for the toolbar button (screen centre converted once in App) and for a
   * double-click on empty board space (the viewport converts). */
  const createAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (typeof id !== 'string') return;
      selection.startEdit(id);
    },
    [doc, selection],
  );

  /** Toolbar button: a note centred in the middle of the visible board area. */
  const createInCentre = useCallback(() => {
    const size = viewportRef.current;
    createAt(screenToWorld(cameraRef.current, { x: size.width / 2, y: size.height / 2 }));
  }, [createAt]);

  /** The bin button deleted a note: drop the selection that pointed at it. */
  const noteDeleted = useCallback((id: string) => {
    const current = selectionRef.current;
    if (current.selectedId === id || current.editingId === id) current.select(null);
  }, []);

  // Test-only hook (excluded from production builds by the mode check).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return registerTestHooks({
      setCamera: (patch) => controllerRef.current.setCamera(patch),
      getCamera: () => controllerRef.current.camera,
    });
  }, []);

  // Enter edits the note; Delete/Backspace deletes it. The note is the selected
  // one, or — for keyboard-only use — the one that has focus. While a note is
  // being edited (or focus is in a field) the keys are left alone, so they edit
  // characters instead of the note.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (selectionRef.current.editingId !== null) return;
      const id = selectionRef.current.selectedId ?? focusedNoteId(event.target);
      if (!id) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        selectionRef.current.startEdit(id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, id);
        selectionRef.current.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  return (
    <div className="vidi6-app" data-testid="app" ref={containerRef}>
      <BoardViewport
        controller={controller}
        onCreateSticky={createAt}
        onClearSelection={() => selection.select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            doc={doc}
            editing={selection.editingId === note.id}
            note={note}
            selected={selection.selectedId === note.id}
            zoom={camera.zoom}
            onDeleted={noteDeleted}
            onEndEdit={selection.endEdit}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createInCentre} />
      <ZoomControls
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onReset={controller.reset}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        zoomPercent={zoomPercent(camera)}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </div>
  );
}

/**
 * The id of the note that has focus, or null. Only the note element itself counts:
 * a focused swatch or bin button must keep the browser's own Enter/Delete meaning.
 */
function focusedNoteId(target: EventTarget | null): string | null {
  return target instanceof HTMLElement ? target.dataset['noteId'] ?? null : null;
}

/**
 * Top-level layout: the infinite board, the bottom-right zoom control and the
 * first-use navigation hint. One camera (`useCamera`) is shared by all three.
 */
export default function App(): React.JSX.Element {
  return <Board />;
}
