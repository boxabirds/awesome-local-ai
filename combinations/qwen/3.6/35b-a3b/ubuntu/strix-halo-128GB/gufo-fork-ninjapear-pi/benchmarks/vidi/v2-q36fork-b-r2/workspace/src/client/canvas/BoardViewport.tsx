import * as React from 'react';
import type { Point, Size } from './camera';
import { GRID_SPACING_WORLD, LINE_TO_PIXELS, PAGE_TO_PIXELS } from '../../shared/config';
import { screenToWorld } from './camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Doc as YDoc } from 'yjs';
import { StickyNote } from '../objects/StickyNote';
import type { Handle } from '../../shared/geometry';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import { SelectionOverlay } from '../board/SelectionOverlay';

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
  snapshosts?: readonly ObjectSnapshot[];
  doc?: YDoc;
  // Selection props (story 7)
  selectedIds?: ReadonlySet<string>;
  editingId?: string | null;
  onSelect?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  onMove?: (id: string, x: number, y: number) => boolean;
  onBringToFront?: (id: string) => boolean;
  onDelete?: (id: string) => void;
  // Gesture hooks (story 7)
  onObjectPointerDown?: (e: PointerEvent, id: string) => void;
  onHandlePointerDown?: (e: PointerEvent, handle: Handle) => void;
  // Story 8: undo controller callbacks
  undo?: () => void;
  redo?: () => void;
}

/**
 * DotGridBackground – creates a repeating dot pattern overlay
 */
function DotGridBackground({ camera }: { camera: { x: number; y: number; zoom: number } }) {
  const spacing = GRID_SPACING_WORLD * camera.zoom;
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
        .selection-handle {
          position: absolute;
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
  const {
    camera,
    useCameraHook,
    children,
    snapshosts,
    selectedIds,
    onObjectPointerDown,
    onHandlePointerDown,
    undo,
    redo,
  } = props;
  
  const [isPanning, setIsPanning] = React.useState(false);
  const lastPosRef = React.useRef<Point | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { beginPan, panMove, endPan, wheel, gestureZoom } = useCameraHook;

  // --- Story 7: Marquee for Shift+drag selection ---
  const handleMarqueeSelect = React.useCallback((ids: string[]) => {
    if (ids.length > 0 && props.onSelect) {
      window.dispatchEvent(new CustomEvent('vidi6:addSelection', { detail: ids }));
    }
  }, [props.onSelect]);

  const marquee = useMarquee({ camera, snapshot: snapshosts ?? [], onSelect: handleMarqueeSelect });

  const wasDraggingMarquee = React.useRef(false);

  const isStickyTarget = React.useCallback((target: EventTarget | null): boolean => {
    if (!target) return false;
    const el = target as HTMLElement;
    return (
      el.closest('.sticky-note') !== null ||
      el.closest('.note-toolbar') !== null ||
      el.closest('.selection-handle') !== null ||
      el.getAttribute('data-object-id') !== null
    );
  }, []);

  const getContainerOffset = () => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    return { x: el.getBoundingClientRect().left, y: el.getBoundingClientRect().top };
  };

  // Pointer down handler
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0 && e.pointerType !== 'pen') return;
      if (isStickyTarget(e.target)) return;

      const offset = getContainerOffset();
      const screenPt = { x: e.clientX - offset.x, y: e.clientY - offset.y };

      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        wasDraggingMarquee.current = true;
        marquee.begin(screenPt);
        try {
          if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
        } catch { /* ignore */ }
        return;
      }

      setIsPanning(true);
      beginPan({ x: e.clientX, y: e.clientY });
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      try {
        if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
      } catch { /* ignore */ }
    },
    [beginPan, isStickyTarget, marquee],
  );

  // Pointer move handler
  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (wasDraggingMarquee.current) {
        const offset = getContainerOffset();
        const screenPt = { x: e.clientX - offset.x, y: e.clientY - offset.y };
        marquee.move(screenPt);
        return;
      }
      if (!isPanning || !lastPosRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      panMove(dx, dy);
    },
    [isPanning, panMove, marquee],
  );

  const handlePointerUp = React.useCallback(() => {
    if (wasDraggingMarquee.current) {
      wasDraggingMarquee.current = false;
      marquee.end();
      setIsPanning(false);
      return;
    }
    if (isPanning) {
      setIsPanning(false);
      endPan();
    }
    lastPosRef.current = null;
  }, [isPanning, endPan, marquee]);

  const handleLostPointerCapture = React.useCallback(() => {
    if (wasDraggingMarquee.current) {
      wasDraggingMarquee.current = false;
      marquee.cancel();
    } else if (isPanning) {
      setIsPanning(false);
      endPan();
    }
    lastPosRef.current = null;
  }, [isPanning, endPan, marquee]);

  // Click on empty board → clear selection
  const handleClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (isStickyTarget(e.target)) return;
      if (!wasDraggingMarquee.current) {
        window.dispatchEvent(new CustomEvent('vidi6:clearSelection'));
      }
    },
    [isStickyTarget],
  );

  // Double-click on empty board → create sticky note
  const handleDoubleClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (isStickyTarget(e.target)) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPt: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      const worldPt = screenToWorld(camera, screenPt);
      window.dispatchEvent(new CustomEvent('vidi6:createSticky', { detail: worldPt }));
    },
    [camera, isStickyTarget],
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
      if (e.deltaMode === 1) { deltaX *= LINE_TO_PIXELS; deltaY *= LINE_TO_PIXELS; }
      else if (e.deltaMode === 2) { deltaX *= PAGE_TO_PIXELS; deltaY *= PAGE_TO_PIXELS; }
      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wheel(deltaX, deltaY, ctrlOrMeta, point);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [wheel]);

  // Escape key cancels marquee
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && marquee.rect) {
        wasDraggingMarquee.current = false;
        marquee.cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [marquee]);

  // Safari gesture events (pinch zoom)
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let centerX = 0;
    let centerY = 0;

    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      const touches = (e as any).touches;
      if (touches && touches.length >= 2) {
        centerX = (touches[0].clientX + touches[1].clientX) / 2;
        centerY = (touches[0].clientY + touches[1].clientY) / 2;
      }
    };

    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as GestureEvent;
      const rect = el.getBoundingClientRect();
      const point: Point = { x: centerX - rect.left, y: centerY - rect.top };
      gestureZoom(ge.scale, point);
    };

    el.addEventListener('gesturestart', handleGestureStart);
    el.addEventListener('gesturechange', handleGestureChange);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
    };
  }, [gestureZoom]);

  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <>
      <DotGridBackground camera={camera} />
      
      {/* World-layer (transformed) — contains sticky notes */}
      <div className="world-layer" style={{ transform: worldTransform }}>
        <OriginMarker />
        {snapshosts?.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={props.doc}
            zoom={camera.zoom}
            selected={!!selectedIds?.has(note.id)}
            editing={props.editingId === note.id}
            camera={camera}
            onSelect={props.onSelect}
            onStartEdit={props.onStartEdit}
            onEndEdit={props.onEndEdit || (() => {})}
            onMove={props.onMove}
            undo={props.undo}
            redo={props.redo}
            onBringToFront={props.onBringToFront}
            onObjectPointerDown={onObjectPointerDown}
          />
        ))}
        {children}
      </div>

      {/* Screen-space overlay layer — viewport-level */}
      <div
        ref={containerRef}
        className={`viewport${isPanning ? ' panning' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleLostPointerCapture}
        onLostPointerCapture={handleLostPointerCapture}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        role="application"
        aria-label="Infinite whiteboard canvas"
      >
        {/* Marquee rectangle (screen-space overlay) */}
        <MarqueeRect rect={marquee.rect || null} camera={camera} />
        
        {/* Selection overlay (screen-space positioning via worldToScreen) */}
        {selectedIds && selectedIds.size > 0 && (
          <SelectionOverlay
            ids={selectedIds}
            snapshot={snapshosts ?? []}
            camera={camera}
            onHandlePointerDown={onHandlePointerDown!}
          />
        )}
      </div>
    </>
  );
}
