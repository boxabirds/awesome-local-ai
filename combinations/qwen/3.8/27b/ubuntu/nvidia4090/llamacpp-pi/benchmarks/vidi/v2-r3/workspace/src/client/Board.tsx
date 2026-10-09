import type { ReactElement } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createSticky,
  deleteObject,
} from '../shared/board-model';
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
import { SharePanel } from './share/SharePanel';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { STICKY_SIZE_WORLD } from '../shared/config';

/**
 * Editing gate (persist.client_status): the board is only non-editable while
 * it failed to load from storage. While reconnecting (storage failure, network
 * drop) the board is still readable and editing stays enabled — unsaved
 * changes are re-sent on reconnection.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

declare global {
  interface Window {
    __vidi6?: {
      setCamera(x: number, y: number, zoom: number): void;
      connectionState: string;
    };
  }
}

/**
 * The board itself (stories 1-4), keyed by board id. Story 5: rendered by
 * BoardPage only after the board's existence check passed; the page's Share
 * control lives here (share.share_panel).
 */
export function Board(props: { boardId: string }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 1280, height: 800 });

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
  const { doc, notes, connectionState } = useBoardDoc(props.boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection(notes);
  const editable = canEdit(connectionState);

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
      if (!editable) return; // load_failed: the board is not editable
      const id = createSticky(doc, {
        x: world.x - STICKY_SIZE_WORLD / 2,
        y: world.y - STICKY_SIZE_WORLD / 2,
      });
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [doc, select, startEdit, editable],
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
        if (editable) startEdit(selectedId);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null && editingId === null) {
        e.preventDefault();
        if (!editable) return; // load_failed: deletion is a no-op
        if (deleteObject(doc, selectedId)) select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cam, selectedId, editingId, doc, select, startEdit, editable]);

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
            editable={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyCenter} disabled={!editable} />
      <ZoomControls
        zoom={cam.camera.zoom}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <SharePanel boardId={props.boardId} />
    </div>
  );
}
