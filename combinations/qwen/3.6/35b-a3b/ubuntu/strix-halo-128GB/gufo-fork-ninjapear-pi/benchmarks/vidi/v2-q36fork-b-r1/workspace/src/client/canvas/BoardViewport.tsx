import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useCamera } from './useCamera';
import { screenToWorld, Camera, Point } from './camera';
import { GRID_SPACING_WORLD, DEFAULT_ORIGIN_MARKER_SIZE, STICKY_SIZE_WORLD } from '../../shared/config';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut } from './camera';

// LINE/PAGE scroll conversion constants (used for deltaMode)
const LINE_TO_PIXEL = 3;
const PAGE_TO_PIXEL = 50;

interface BoardViewportProps {
  children?: ReactNode;
  onCameraChange?(cam: Camera): void;
  onDblClickEmpty(x: number, y: number): void;
  onClickEmpty(): void;
}

export function BoardViewport({ children, onCameraChange, onDblClickEmpty, onClickEmpty }: BoardViewportProps): ReactNode {
  // --- Viewport size ---
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  // --- Camera state & handlers ---
  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel: handleWheel,
    zoomAt: handleZoomAt,
    zoomStep,
    reset,
  } = useCamera(size);

  // Notify parent of camera changes
  useEffect(() => {
    if (onCameraChange) {
      onCameraChange(camera);
    }
  }, [camera, onCameraChange]);

  // Refs for keyboard handler access (so handlers always see latest callbacks)
  const zoomStepRef = useRef(zoomStep);
  const resetRef = useRef(reset);
  zoomStepRef.current = zoomStep;
  resetRef.current = reset;

  // Track pointer capture state for cursor styling
  const isCapturingRef = useRef(false);

  // Track if current pointer interaction started on a child element (note) vs empty space
  const pointerOnChildRef = useRef(false);

  // ResizeObserver — viewport size from the element itself
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Pointer drag ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      // Check if target is in the world layer (contains sticky notes etc.)
      const worldLayer = e.currentTarget.querySelector('[style*="transform-origin"]');
      if (worldLayer && worldLayer.contains(e.target as Node)) {
        pointerOnChildRef.current = true;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      isCapturingRef.current = true;
      pointerOnChildRef.current = false;
      beginPan({ x: e.clientX, y: e.clientY });
    },
    [beginPan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isCapturingRef.current || pointerOnChildRef.current) return;
      panMove({ x: e.clientX, y: e.clientY });
    },
    [panMove],
  );

  const handlePointerUpOrCancel = useCallback(() => {
    if (!isCapturingRef.current || pointerOnChildRef.current) {
      isCapturingRef.current = false;
      pointerOnChildRef.current = false;
      endPan();
      return;
    }
    isCapturingRef.current = false;
    endPan();
    onClickEmpty();
  }, [endPan, onClickEmpty]);

  // --- Double click on empty space → create sticky ---
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      const worldLayer = e.currentTarget.querySelector('[style*="transform-origin"]');
      if (worldLayer && worldLayer.contains(e.target as Node)) {
        return; // Double-clicked on a note
      }
      const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      onDblClickEmpty(wp.x - STICKY_SIZE_WORLD / 2, wp.y - STICKY_SIZE_WORLD / 2);
    },
    [camera, onDblClickEmpty],
  );

  // --- Wheel (captured phase) ---
  const handleWheelCapture = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      let dx = e.deltaX;
      let dy = e.deltaY;

      if (e.deltaMode === 1) {
        dx *= LINE_TO_PIXEL;
        dy *= PAGE_TO_PIXEL;
      } else if (e.deltaMode === 2) {
        dx *= PAGE_TO_PIXEL;
        dy *= PAGE_TO_PIXEL;
      }

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      handleWheel({ deltaX: dx, deltaY: dy, ctrlOrMeta, point: { x: e.clientX, y: e.clientY } });
    },
    [handleWheel],
  );

  // --- Safari gesture events ---
  const handleGestureStart = useCallback((e: Event) => {
    if ('preventDefault' in e) e.preventDefault();
  }, []);

  const handleGestureChange = useCallback(
    (e: any) => {
      e.preventDefault();
      const factor = e.scale;
      if (!isFinite(factor) || factor <= 0) return;
      handleZoomAt({ x: size.width / 2, y: size.height / 2 }, factor);
    },
    [handleZoomAt, size],
  );

  // --- Keyboard shortcuts (Ctrl/Cmd + =/-/0) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStepRef.current('in');
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        zoomStepRef.current('out');
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        resetRef.current();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Computed dot-grid styles ---
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgPosX = (-camera.x * camera.zoom) % spacing;
  const bgPosY = (-camera.y * camera.zoom) % spacing;
  const cursorStyle = isCapturingRef.current ? 'grabbing' : 'default';

  // Origin marker position
  const markerSize = DEFAULT_ORIGIN_MARKER_SIZE;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Board canvas */}
      <div
        ref={viewportRef}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          cursor: cursorStyle,
          touchAction: 'none',
          backgroundColor: '#f8f9fa',
          backgroundImage: `radial-gradient(circle, #adb5bd 1px, transparent 1px)`,
          backgroundSize: `${spacing}px ${spacing}px`,
          backgroundPosition: `${bgPosX}px ${bgPosY}px`,
        }}
        onWheel={handleWheelCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onLostPointerCapture={() => {
          isCapturingRef.current = false;
          pointerOnChildRef.current = false;
          endPan();
        }}
        onGotPointerCapture={() => {
          isCapturingRef.current = true;
        }}
        onDoubleClick={handleDoubleClick}
        onGestureStart={handleGestureStart}
        onGestureChange={handleGestureChange}
        aria-label="Infinite board"
      >
        {/* World layer */}
        <div
          style={{
            position: 'absolute',
            transformOrigin: '0 0',
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
            width: 0,
            height: 0,
          }}
        >
          {/* Origin marker — a small crosshair at world (0,0) */}
          <div
            className="origin-marker"
            style={{
              position: 'absolute',
              left: -markerSize / 2,
              top: -markerSize / 2,
              width: markerSize,
              height: markerSize,
              pointerEvents: 'none',
            }}
            data-testid="origin-marker"
          >
            <svg width={markerSize} height={markerSize} viewBox={`0 0 ${markerSize} ${markerSize}`}>
              <circle cx={markerSize / 2} cy={markerSize / 2} r={2} fill="#e03131" />
              <line x1={2} y1={markerSize / 2} x2={markerSize - 2} y2={markerSize / 2} stroke="#e03131" strokeWidth={0.5} />
              <line x1={markerSize / 2} y1={2} x2={markerSize / 2} y2={markerSize - 2} stroke="#e03131" strokeWidth={0.5} />
            </svg>
          </div>

          {/* User-rendered children (later stories add content here) */}
          {children}
        </div>
      </div>

      {/* UI overlay — zoom controls */}
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />

      {/* UI overlay — navigation hint */}
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
