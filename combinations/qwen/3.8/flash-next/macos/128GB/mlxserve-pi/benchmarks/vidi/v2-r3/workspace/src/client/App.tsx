import { useEffect, useMemo, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { boardIdForPath, boardPath } from '../shared/routes';
import { reportConnectionState, setOutageHandler } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';

/** Is the keyboard focus inside something that owns Delete/Backspace/Enter? */
function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export interface AppProps {
  /**
   * Test seam: hands the board's Y.Doc to the caller once, so component
   * tests can create and delete notes through the model while the app keeps
   * rendering them. Unused by the app itself.
   */
  onDocReady?(doc: Y.Doc): void;
  /**
   * The board to open, instead of the one the address names. Only a test needs
   * it: two component tests on one page would otherwise share a board.
   */
  boardId?: string;
}

/**
 * Top-level layout and wiring. The camera lives in useCamera (story 1); the
 * notes live in a Y.Doc owned by useBoardDoc (stories 3 and 4 will sync and
 * persist that same document); which note is selected or edited is local
 * interaction state and is never written to the document.
 */
export function App(props: AppProps = {}): JSX.Element {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);
  const { camera } = cam;
  // The board this browser is on is the board its address names. At the root, or
  // at an address that names no board, this makes one and puts its address in the
  // bar, so the address a person shares is the one they are looking at (story 5
  // moves board creation to the server; until then a board exists from the
  // moment somebody opens its address).
  const [boardId] = useState(() => props.boardId ?? boardIdForPath(window.location.pathname));
  useEffect(() => {
    const path = boardPath(boardId);
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
  }, [boardId]);

  const { doc, notes, connection, emulateOutage } = useBoardDoc(boardId);
  const selection = useSelection();

  // A test build lets the test take this board's link down; the app never does.
  useEffect(() => {
    setOutageHandler((ms: number) => emulateOutage(ms));
  }, [emulateOutage]);

  // The connection state a test can read as well as see. The badge is only up
  // for two seconds of a 45-second idle wait, so a test that has to know what
  // the connection said in that time reads it here rather than the screen.
  useEffect(() => {
    reportConnectionState(connection);
  }, [connection]);

  // A note can disappear at any moment (its bin button, the Delete key, later
  // another person). Selection and editing are filtered to ids that still
  // exist, so a stale note never stays selected and never ends mid-drag or
  // mid-edit with a dangling outline.
  const selectedId = notes.some((note) => note.id === selection.selectedId) ? selection.selectedId : null;
  const editingId = notes.some((note) => note.id === selection.editingId) ? selection.editingId : null;

  // The board renders notes in a stable order (by id) and lets CSS z-index do
  // the stacking. Reordering keyed children would move the dragged note's DOM
  // node out of the document, which drops pointer capture and kills the drag
  // the moment it is brought to the front.
  const rendered = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [notes]);

  const { onDocReady } = props;
  useEffect(() => {
    if (onDocReady !== undefined) onDocReady(doc);
  }, [doc, onDocReady]);

  /** Create a note centred on a world point and start typing straight away. */
  const createAt = (world: Point): void => {
    const id = createSticky(doc, world);
    if (id !== '') selection.startEdit(id);
  };

  const createAtViewportCentre = (): void => {
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  };

  // Board-wide keyboard rules for the selected note. While a note is being
  // edited these keys belong to its textarea and are left completely alone.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (selectedId === null || editingId !== null || isTextTarget(e.target)) return;
        e.preventDefault();
        selection.startEdit(selectedId);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId === null || editingId !== null || isTextTarget(e.target)) return;
        e.preventDefault();
        deleteObject(doc, selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, selection]);

  return (
    <div className="app">
      <BoardViewport
        camera={camera}
        onViewportSize={setViewport}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onZoomAtPoint={cam.zoomAtPoint}
        onZoomStep={cam.zoomStep}
        onReset={cam.reset}
        onEmptyDblClick={(point) => {
          createAt(screenToWorld(camera, point));
        }}
        onEmptyClick={() => {
          selection.select(null);
        }}
      >
        {rendered.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={(id) => {
              selection.select(id);
            }}
            onStartEdit={(id) => {
              selection.startEdit(id);
            }}
            onEndEdit={(next) => {
              selection.endEdit(next);
            }}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtViewportCentre} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <ConnectionStatus state={connection} />
    </div>
  );
}
