import type { ReactElement } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createSticky,
  deleteObject,
} from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import type { Point, Size } from './canvas/camera';
import { screenToWorld } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { STICKY_SIZE_WORLD } from '../shared/config';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(x: number, y: number, zoom: number): void;
      connectionState: string;
    };
  }
}

function boardIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/b\/([^/]+)\/?$/);
  if (!m) return null;
  return isValidBoardId(m[1]) ? m[1] : null;
}

export default function App(): ReactElement {
  const [boardId, setBoardId] = useState<string | null>(() => boardIdFromPath(location.pathname));
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 1280, height: 800 });

  // Temporary routing (replaced by server-side board creation in story 5):
  // `/` redirects to a freshly generated board address.
  useEffect(() => {
    if (boardId === null) {
      const id = newBoardId();
      history.replaceState(null, '', `/b/${id}`);
      setBoardId(id);
    }
  }, [boardId]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () =>
      setSize({ width: el.clientWidth || window.innerWidth, height: el.clientHeight || window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection(notes);

  // Test-only hooks (excluded from production builds).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    window.__vidi6 = {
      setCamera: (x, y, zoom) => cam.setCameraDirect({ x, y, zoom }),
      connectionState,
    };
  }, [cam, connectionState]);

  const createStickyAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, {
        x: world.x - STICKY_SIZE_WORLD / 2,
        y: world.y - STICKY_SIZE_WORLD / 2,
      });
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [doc, select, startEdit],
  );

  const createStickyCenter = useCallback(() => {
    createStickyAt(screenToWorld(cam.camera, { x: size.width / 2, y: size.height / 2 }));
  }, [createStickyAt, cam.camera, size]);

  // Keyboard: zoom shortcuts, Enter to edit, Delete/Backspace to delete the
  // selected note (never while editing text).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        cam.zoomStep('in');
        return;
      }
      if (mod && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        cam.zoomStep('out');
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        cam.reset();
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if (inField) return;
      if (e.key === 'Enter' && selectedId !== null && editingId === null) {
        e.preventDefault();
        startEdit(selectedId);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null && editingId === null) {
        e.preventDefault();
        if (deleteObject(doc, selectedId)) select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cam, selectedId, editingId, doc, select, startEdit]);

  // A pointerdown outside the note being edited ends editing (unselected).
  useEffect(() => {
    if (editingId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = document.querySelector(`[data-note-id="${CSS.escape(editingId)}"]`);
      if (el && el.contains(e.target as Node)) return;
      endEdit('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editingId, endEdit]);

  return (
    <div
      ref={rootRef}
      className="app"
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#f3f5f8' }}
    >
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        size={size}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onDblClickEmpty={(world: Point) => createStickyAt(world)}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyCenter} />
      <ZoomControls
        zoom={cam.camera.zoom}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
