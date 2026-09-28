// Top-level layout: full-window board, left toolbar, bottom-right zoom
// controls, bottom-centre first-use hint, and the floating note toolbar for
// the selected note. One shared camera and one shared Y.Doc drive the board.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, screenToWorld, worldToScreen, zoomPercent, type Point, type Size } from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { newBoardId, BOARD_ID_PATTERN } from '../shared/board-id';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { NOTE_TOOLBAR_GAP_PX, NoteToolbar } from './objects/NoteToolbar';
import { StickyNote } from './objects/StickyNote';
import { deleteObject, setStickyColor, createSticky } from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';

function useViewportSize(ref: React.RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * Board address from the URL: /b/<boardId>. On any other path (e.g. /) a
 * fresh id is generated and the URL replaced. Story 5 replaces this with
 * server-side board creation.
 */
const BOARD_PATH_PATTERN = new RegExp(`^/b/(${BOARD_ID_PATTERN.source.slice(1, -1)})$`);

function useBoardId(): string {
  const [id] = useState<string>(() => {
    const match = window.location.pathname.match(BOARD_PATH_PATTERN);
    if (match !== null) return match[1];
    const fresh = newBoardId();
    window.history.replaceState(null, '', `/b/${fresh}`);
    return fresh;
  });
  return id;
}

export default function App(): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const camera = useCamera(viewport);
  const boardId = useBoardId();
  const { doc, notes, connectionState, connectionRef } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [dragging, setDragging] = useState(false);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const docRef = useRef(doc);
  docRef.current = doc;
  const connectionStateRef = useRef(connectionState);
  connectionStateRef.current = connectionState;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    installTestHooks(
      () => cameraRef.current,
      () => docRef.current,
      () => connectionStateRef.current,
      () => connectionRef.current,
      () => selectedIdRef.current,
    );
  }, []);

  // A note deleted from under the selection (keyboard, toolbar, or a
  // concurrent client) clears selection and editing, ending any edit.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
    if (editingId !== null && !notes.some((n) => n.id === editingId)) endEdit('unselected');
  }, [notes, selectedId, editingId, select, endEdit]);

  // Window keyboard: Enter starts editing the selected note; Delete/Backspace
  // delete it. Ignored while editing text (the textarea owns those keys) and
  // when focus is in any input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (editingId !== null) return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (selectedId === null) return; // nothing selected: nothing happens
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (deleteObject(doc, selectedId)) select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, startEdit, select, doc]);

  const createStickyAtScreen = (p: Point): void => {
    const world = screenToWorld(cameraRef.current.camera, p);
    const id = createSticky(doc, world);
    if (id !== '') startEdit(id);
  };

  const createStickyAtCenter = (): void => {
    createStickyAtScreen({ x: viewport.width / 2, y: viewport.height / 2 });
  };

  const selectedNote = selectedId !== null ? notes.find((n) => n.id === selectedId) ?? null : null;
  const noteTopLeft =
    selectedNote !== null ? worldToScreen(camera.camera, { x: selectedNote.x, y: selectedNote.y }) : null;

  return (
    <div className="board-root" ref={rootRef}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        onDblClickEmpty={(p) => createStickyAtScreen(p)}
        onEmptyClick={() => {
          if (editingId !== null) endEdit('unselected');
          else select(null);
        }}
      >
        {notes.map((n) => (
          <StickyNote
            key={n.id}
            note={n}
            doc={doc}
            zoom={camera.camera.zoom}
            selected={n.id === selectedId}
            editing={n.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDraggingChange={setDragging}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyAtCenter} />
      {selectedNote !== null && noteTopLeft !== null && !editingId && !dragging && (
        <div
          className="note-toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{
            position: 'fixed',
            left: noteTopLeft.x + (STICKY_SIZE_WORLD * camera.camera.zoom) / 2,
            top: noteTopLeft.y - NOTE_TOOLBAR_GAP_PX,
            transform: 'translate(-50%, -100%)',
            zIndex: 20,
          }}
        >
          <NoteToolbar
            color={selectedNote.color}
            onColor={(c) => setStickyColor(doc, selectedNote.id, c)}
            onDelete={() => {
              deleteObject(doc, selectedNote.id);
              select(null);
            }}
          />
        </div>
      )}
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={() => camera.reset()}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </div>
  );
}
