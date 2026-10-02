import { useRef, useLayoutEffect, useState, useEffect, useCallback, useMemo } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, type Camera, type Point } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, getStickyText, snapshot } from '../shared/board-model';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getBoardDoc(): Y.Doc;
      getBoardSnapshot(): readonly { id: string; x: number; y: number; z: number; color: string; text: string }[];
      /** Test-only: create a sticky at a world point (bypasses the UI). */
      createStickyAtWorld(p: { x: number; y: number }): string | false;
      /** Test-only: set a sticky's text directly. */
      setStickyText(id: string, text: string): void;
    };
  }
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 800 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStepFn, reset, setCamera } =
    useCamera(size);

  const { doc, stickies } = useBoardDoc();

  // Render in a stable order (by id), not the model's z-sorted order: when a
  // note is brought to the front its z changes and the z-sorted array
  // reorders, which would make React move the note's DOM node. A DOM move
  // during an active drag drops the browser's pointer capture and kills the
  // drag. Stacking is handled by CSS z-index on each note instead.
  const renderStickies = useMemo(
    () => [...stickies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [stickies],
  );
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [isPanning, setIsPanning] = useState(false);

  const handlePointerDown = (p: { x: number; y: number }) => {
    setIsPanning(true);
    beginPan(p);
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    endPan();
  };

  const handlePointerCancel = () => {
    setIsPanning(false);
    endPan();
  };

  // Create a sticky note centred on a viewport-relative screen point, then
  // select it and start editing so typing goes straight into the note.
  const createStickyAtScreen = useCallback(
    (p: Point) => {
      const world = screenToWorld(cameraRef.current, p);
      const id = createSticky(doc, world);
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [doc, select, startEdit],
  );

  const handleDblClickEmpty = useCallback(
    (p: Point) => createStickyAtScreen(p),
    [createStickyAtScreen],
  );

  // Toolbar button: centre of the visible board area (works when panned far away).
  const handleCreateSticky = useCallback(() => {
    createStickyAtScreen({ x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 });
  }, [createStickyAtScreen]);

  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // it. Both are ignored while editing text (the textarea owns the keys).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if (inEditable) return;

      if (e.key === 'Enter') {
        if (selectedId && !editingId) {
          e.preventDefault();
          startEdit(selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && !editingId) {
          e.preventDefault();
          if (deleteObject(doc, selectedId)) select(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingId, doc, select, startEdit]);

  // Test hooks for e2e / component tests
  useEffect(() => {
    window.__vidi6 = {
      setCamera,
      getBoardDoc: () => doc,
      getBoardSnapshot: () => snapshot(doc),
      createStickyAtWorld: (p) => createSticky(doc, p),
      setStickyText: (id, text) => {
        const t = getStickyText(doc, id);
        if (t) {
          t.delete(0, t.length);
          t.insert(0, text);
        }
      },
    };
    return () => {
      delete window.__vidi6;
    };
  }, [setCamera, doc]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <BoardViewport
        camera={camera}
        isPanning={isPanning}
        onPointerDown={handlePointerDown}
        onPointerMove={panMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={wheel}
        onKeyZoomIn={() => zoomStepFn('in')}
        onKeyZoomOut={() => zoomStepFn('out')}
        onKeyReset={reset}
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
      >
        {renderStickies.map((s) => (
          <StickyNote
            key={s.id}
            note={s}
            doc={doc}
            zoom={camera.zoom}
            selected={s.id === selectedId}
            editing={s.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateSticky} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStepFn('in')}
        onZoomOut={() => zoomStepFn('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
