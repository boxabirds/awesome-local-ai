import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useStickyNoteKeys } from './board/useStickyNoteKeys';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size
} from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { BoardCameraContext, useCamera } from './canvas/useCamera';
import { NoteToolbar } from './objects/NoteToolbar';
import { StickyNote, STICKY_PADDING_WORLD } from './objects/StickyNote';

const NOTE_TOOLBAR_GAP_PX = 12;

export interface AppProps {
  // Tests inject their own Y.Doc; production supplies none.
  doc?: Y.Doc;
}

function measure(el: HTMLElement | null): Size {
  const width = el?.clientWidth || window.innerWidth;
  const height = el?.clientHeight || window.innerHeight;
  return { width, height };
}

export function App({ doc: providedDoc }: AppProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>(() => measure(null));
  useEffect(() => {
    const update = () => {
      const next = measure(rootRef.current);
      setViewport((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      );
    };
    update();
    const el = rootRef.current;
    if (typeof ResizeObserver !== 'undefined' && el !== null) {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const board = useCamera(viewport);
  const { doc, notes } = useBoardDoc(providedDoc);
  const selection = useSelection();
  const { selectedId, editingId, draggingId, select, startEdit, endEdit, setDragging } =
    selection;

  useEffect(() => {
    installTestHooks(board.setCamera, doc);
  }, [board.setCamera, doc]);

  useStickyNoteKeys(doc, selection);

  const createAtWorldPoint = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      startEdit(id);
    },
    [doc, startEdit]
  );

  const onDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      createAtWorldPoint(screenToWorld(board.camera, screenPoint));
    },
    [board.camera, createAtWorldPoint]
  );

  const onCreateSticky = useCallback(() => {
    // Centre of the visible board area, wherever the board has been panned.
    createAtWorldPoint(
      screenToWorld(board.camera, { x: viewport.width / 2, y: viewport.height / 2 })
    );
  }, [board.camera, createAtWorldPoint, viewport]);

  const { camera, hasNavigated } = board;
  const selectedNote = selectedId === null ? undefined : notes.find((n) => n.id === selectedId);

  return (
    <BoardCameraContext.Provider value={board}>
      <div
        ref={rootRef}
        className="board-root"
        style={{ '--sticky-padding': `${STICKY_PADDING_WORLD}px` } as React.CSSProperties}
      >
        <BoardViewport
          onDoubleClickEmpty={onDoubleClickEmpty}
          onEmptyClick={() => {
            select(null);
          }}
        >
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
              onDraggingChange={setDragging}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={onCreateSticky} />
        {selectedNote !== undefined && editingId === null && draggingId === null && (
          <div
            className="note-toolbar-anchor"
            style={{
              left: worldToScreen(camera, {
                x: selectedNote.x + STICKY_SIZE_WORLD / 2,
                y: selectedNote.y
              }).x,
              top:
                worldToScreen(camera, { x: selectedNote.x, y: selectedNote.y }).y -
                NOTE_TOOLBAR_GAP_PX
            }}
          >
            <NoteToolbar
              color={selectedNote.color}
              onColor={(color) => {
                setStickyColor(doc, selectedNote.id, color);
              }}
              onDelete={() => {
                deleteObject(doc, selectedNote.id);
                select(null);
              }}
            />
          </div>
        )}
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </div>
    </BoardCameraContext.Provider>
  );
}
