// The board UI: canvas viewport + notes + toolbars + connection badge + share.
// Story 5 mounts this only when the board is known to exist (BoardPage Ready).

import { useCallback, useEffect, useRef, useState } from 'react';
import { STICKY_SIZE_WORLD } from '../../shared/config';
import { createSticky, deleteObject, getStickyText } from '../../shared/board-model';
import { BoardViewport, type Rect } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { SharePanel } from '../share/SharePanel';

export function BoardWorkspace({ boardId }: { boardId: string }) {
  const { doc, notes, provider } = useBoardDoc(boardId);
  const controller = useCamera();
  const selection = useSelection();
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = (): void => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const addStickyAt = useCallback(
    (world: { x: number; y: number }) => {
      const id = createSticky(doc, { x: world.x - STICKY_SIZE_WORLD / 2, y: world.y - STICKY_SIZE_WORLD / 2 });
      if (id) selection.select(id);
    },
    [doc, selection],
  );

  const addStickyCenter = useCallback((): void => {
    addStickyAt(screenToWorld(controller.camera, viewport.width / 2, viewport.height / 2));
  }, [addStickyAt, controller, viewport]);

  const handleMarquee = useCallback(
    (rect: Rect | null, final: boolean): void => {
      if (!final) {
        setMarquee(rect);
        return;
      }
      setMarquee(null);
      if (!rect) {
        selection.clear();
        return;
      }
      const hits = notes
        .filter((note) => {
          const origin = worldToScreen(controller.camera, note.x, note.y);
          return (
            origin.x < rect.x + rect.width &&
            origin.x + STICKY_SIZE_WORLD * controller.camera.zoom > rect.x &&
            origin.y < rect.y + rect.height &&
            origin.y + STICKY_SIZE_WORLD * controller.camera.zoom > rect.y
          );
        })
        .map((note) => note.id);
      selection.selectAll(hits);
    },
    [controller.camera, notes, selection],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const editing = !!target?.closest('.sticky-editor');
      if (event.key === 'Escape') {
        selection.clear();
        return;
      }
      if (editing) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.selected.size === 0) return;
        event.preventDefault();
        for (const id of selection.selected) deleteObject(doc, id);
        selection.clear();
        return;
      }
      if ((event.key === 'a' || event.key === 'A') && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        selection.selectAll(notes.map((note) => note.id));
        return;
      }
      if (event.key === '+' || event.key === '=') {
        controller.zoomStep(viewport, 1);
      } else if (event.key === '-' || event.key === '_') {
        controller.zoomStep(viewport, -1);
      } else if (event.key === '0') {
        controller.resetZoom(viewport);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, doc, notes, selection, viewport]);

  return (
    <div className="board-workspace" ref={wrapperRef} data-testid="board-workspace">
      <BoardViewport
        camera={controller.camera}
        controller={controller}
        onMarquee={handleMarquee}
        onDoubleClickEmpty={addStickyAt}
        overlay={
          marquee && marquee.width + marquee.height > 0 ? (
            <div
              className="marquee"
              style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
            />
          ) : null
        }
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            yText={getStickyText(doc, note.id)}
            doc={doc}
            zoom={controller.camera.zoom}
            selected={selection.isSelected(note.id)}
            onSelect={selection.toggle}
          />
        ))}
      </BoardViewport>

      <Toolbar onAddSticky={addStickyCenter} />
      <div className="top-bar">
        <ConnectionStatus provider={provider} />
        <SharePanel boardId={boardId} />
      </div>
      <ZoomControls controller={controller} viewport={viewport} />
      <NavigationHint />
    </div>
  );
}
