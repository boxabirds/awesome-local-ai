import * as React from 'react';
import type { Point, Size } from './camera';
import { GRID_SPACING_WORLD, LINE_TO_PIXELS, PAGE_TO_PIXELS } from '../../shared/config';
import { screenToWorld } from './camera';
import type { StickySnapshot } from '../../shared/board-model';
import type { Doc as YDoc } from 'yjs';
import { StickyNote } from '../objects/StickyNote';

interface BoardViewportProps {
  camera: { x: number; y: number; zoom: number };
  useCameraHook: {
    beginPan(p: Point): void;
    panMove(dX: number, dY: number): void;
    endPan(): void;
    wheel(deltaX: number, deltaY: number, ctrlOrMeta: boolean, point: Point): void;
    gestureZoom(scale: number, point: Point): void;
  };
  children?: React.ReactNode;
  // Sticky note props (from story 2)
  snapshosts?: readonly StickySnapshot[];
  doc?: YDoc;
  selectedId?: string | null;
  editingId?: string | null;
  onSelect?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  onMove?: (id: string, x: number, y: number) => boolean;
  onBringToFront?: (id: string) => boolean;
  onDelete?: (id: string) => void;
}

/**
 * DotGridBackground – creates a repeating dot pattern overlay
 * that moves with the camera via background-size and background-position.
 */
function DotGridBackground({ camera }: { camera: { x: number; y: number; zoom: number } }) {
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Position so the grid appears attached to the board
  const posXM = (-camera.x * camera.zoom) % spacing;
  const posYM = (-camera.y * camera.zoom) % spacing;

  return (
    <>
      <style>{`
        .dot-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: radial-gradient(circle, #c0c0c0 1px, transparent 1px);
          background-size: ${spacing}px ${spacing}px;
          background-position: ${posXM}px ${posYM}px;
          background-repeat: repeat;
        }
        .world-layer {
          position: absolute;
          transform-origin: 0 0;
          width: 0;
          height: 0;
        }
        .origin-marker {
          position: absolute;
          left: -6px;
          top: -6px;
          width: 12px;
          height: 12px;
          pointer-events: none;
        }
        .origin-marker::before,
        .origin-marker::after {
          content: '';
          position: absolute;
          background: #ff4444;
        }
        .origin-marker::before {
          left: 5px; top: 0;
          width: 2px; height: 12px;
        }
        .origin-marker::after {
          top: 5px; left: 0;
          height: 2px; width: 12px;
        }
        .viewport {
          position: fixed;
          inset: 0;
          overflow: hidden;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
        }
        .viewport.panning {
          cursor: grabbing;
        }
      `}</style>
      <div className="dot-grid" aria-hidden="true" />
    </>
  );
}

function OriginMarker() {
  return (
    <div className="origin-marker" aria-label="Origin (0, 0)" data-testid="origin-marker" />
  );
}

export function BoardViewport(props: BoardViewportProps): React.JSX.Element {
  const { camera, useCameraHook, children, snapshosts } = props;
  const [isPanning, setIsPanning] = React.useState(false);
  const lastPosRef = React.useRef<Point | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { beginPan, panMove, endPan, wheel, gestureZoom } = useCameraHook;

  // Check if pointerdown target is a sticky note or empty board
  const isStickyNoteTarget = React.useCallback((target: EventTarget | null): boolean => {
    if (!target) return false;
    const el = target as HTMLElement;
    return el.closest('.sticky-note') !== null || el.closest('.note-toolbar') !== null;
  }, []);

  // Pointer events for drag-to-pan
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') {
        return;
      }
      if (e.button !== 0 && e.pointerType !== 'pen') return;

      // If clicking on a sticky note or toolbar, let those components handle it
      if (isStickyNoteTarget(e.target)) {
        return;
      }

      setIsPanning(true);
      beginPan({ x: e.clientX, y: e.clientY });
      lastPosRef.current = { x: e.clientX, y: e.clientY };

      try {
        const el = containerRef.current;
        if (el) {
          el.setPointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    },
    [beginPan, isStickyNoteTarget],
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning || !lastPosRef.current) return;

      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };

      panMove(dx, dy);
    },
    [isPanning, panMove],
  );

  const handlePointerUp = React.useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      endPan();
    }
    lastPosRef.current = null;
  }, [isPanning, endPan]);

  const handleLostPointerCapture = React.useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      endPan();
    }
    lastPosRef.current = null;
  }, [isPanning, endPan]);

  // Click on empty board → deselect (stop propagation handled by sticky notes)
  const handlePointerClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (isStickyNoteTarget(e.target)) return;
      // Empty click on board
    },
    [isStickyNoteTarget],
  );

  // Double-click on empty board space → create sticky note
  const handleDoubleClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (isStickyNoteTarget(e.target)) return;

      // Create a note centred on the click point
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPt: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      const worldPt = screenToWorld(camera, screenPt);
      // Call createSticky from the parent via window event or callback
      window.dispatchEvent(new CustomEvent('vidi6:createSticky', { detail: worldPt }));
    },
    [camera, isStickyNoteTarget],
  );

  // Wheel handler
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) {
        deltaX *= LINE_TO_PIXELS;
        deltaY *= LINE_TO_PIXELS;
      } else if (e.deltaMode === 2) {
        deltaX *= PAGE_TO_PIXELS;
        deltaY *= PAGE_TO_PIXELS;
      }

      const rect = el.getBoundingClientRect();
      const point: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      wheel(deltaX, deltaY, ctrlOrMeta, point);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [wheel]);

  // Safari gesture events
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleGestureStart = (e: Event) => {
      (e as GestureEvent).preventDefault();
    };

    const handleGestureChange = (e: Event) => {
      (e as GestureEvent).preventDefault();
      const ge = e as GestureEvent;
      if (!Number.isFinite(ge.scale)) return;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      gestureZoom(ge.scale, { x: cx, y: cy });
    };

    let rect: DOMRectReadOnly;
    const updateRect = () => {
      rect = el.getBoundingClientRect();
    };
    updateRect();

    el.addEventListener('gesturestart', handleGestureStart as EventListener);
    el.addEventListener('gesturechange', handleGestureChange as EventListener);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart as EventListener);
      el.removeEventListener('gesturechange', handleGestureChange as EventListener);
    };
  }, [gestureZoom]);

  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <>
      <DotGridBackground camera={camera} />
      <div
        ref={containerRef}
        className={`viewport${isPanning ? ' panning' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleLostPointerCapture}
        onLostPointerCapture={handleLostPointerCapture}
        onClick={handlePointerClick}
        onDoubleClick={handleDoubleClick}
        role="application"
        aria-label="Infinite whiteboard canvas"
      >
        <div className="world-layer" style={{ transform: worldTransform }}>
          <OriginMarker />
          {/* Render sticky notes from snapshots */}
          {snapshosts?.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={props.doc!}
              zoom={camera.zoom}
              selected={props.selectedId === note.id}
              editing={props.editingId === note.id}
              camera={camera}
              onSelect={props.onSelect!}
              onStartEdit={props.onStartEdit!}
              onEndEdit={props.onEndEdit!}
              onMove={props.onMove}
              onBringToFront={props.onBringToFront}
            />
          ))}
          {children}
        </div>
      </div>
    </>
  );
}
