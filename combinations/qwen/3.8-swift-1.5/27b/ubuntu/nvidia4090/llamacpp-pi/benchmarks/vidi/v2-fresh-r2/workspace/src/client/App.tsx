import { useLayoutEffect, useRef, useState, useCallback, useEffect } from 'react';
import type { JSX } from 'react';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld } from './canvas/camera';
import type { Size } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';

const INITIAL_SIZE: Size = { width: 0, height: 0 };

export function App(): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(INITIAL_SIZE);

  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const controls = useCamera(size);
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Create a sticky note at a screen point
  const handleCreateAtScreenPoint = useCallback(
    (screenPoint: { x: number; y: number }) => {
      const worldPoint = screenToWorld(controls.camera, screenPoint);
      const id = createSticky(doc, worldPoint);
      startEdit(id);
    },
    [doc, controls.camera, startEdit],
  );

  // Create from toolbar button (centre of viewport)
  const handleCreateSticky = useCallback(() => {
    const centre = { x: size.width / 2, y: size.height / 2 };
    handleCreateAtScreenPoint(centre);
  }, [size, handleCreateAtScreenPoint]);

  // Double-click on empty board space
  const handleDblClickEmpty = useCallback(
    (point: { x: number; y: number }) => {
      handleCreateAtScreenPoint(point);
    },
    [handleCreateAtScreenPoint],
  );

  // Click on empty board space → clear selection
  const handleClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard handler: Enter to edit, Delete/Backspace to delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingId, doc, select, startEdit]);

  return (
    <div ref={shellRef} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <BoardViewport
        controls={controls}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={controls.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateSticky} />
      <ZoomControls
        zoomPercent={zoomPercent(controls.camera)}
        canZoomIn={canZoomIn(controls.camera)}
        canZoomOut={canZoomOut(controls.camera)}
        onZoomIn={() => controls.zoomStep('in')}
        onZoomOut={() => controls.zoomStep('out')}
        onReset={controls.reset}
      />
      <NavigationHint visible={!controls.hasNavigated} />
    </div>
  );
}
