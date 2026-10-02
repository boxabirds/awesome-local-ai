import { useCallback, useRef, useState } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';

/**
 * Story 7: shift+drag marquee selection on empty board space. The rect is
 * tracked in WORLD space (so it stays anchored while panning/zooming) and
 * committed once on pointer up: `onCommit(rect, additive)` where additive is
 * true for a shift-drag (union with the current selection).
 */
export interface Marquee {
  active: boolean;
  /** The current marquee rect in world space (null when inactive). */
  rect: Rect | null;
  /** Begin a marquee from a pointerdown on empty space. */
  begin: (e: PointerEvent) => void;
}

export function useMarquee(
  camera: Camera,
  onCommit: (rect: Rect, additive: boolean) => void,
): Marquee {
  const [marquee, setMarquee] = useState<{ startScreen: Point; startWorld: Point; currentWorld: Point } | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const begin = useCallback((e: PointerEvent) => {
    const startScreen: Point = { x: e.clientX, y: e.clientY };
    const startWorld = screenToWorld(cameraRef.current, startScreen);
    setMarquee({ startScreen, startWorld, currentWorld: startWorld });

    const onMove = (ev: PointerEvent) => {
      const currentWorld = screenToWorld(cameraRef.current, { x: ev.clientX, y: ev.clientY });
      setMarquee((m) => (m ? { ...m, currentWorld } : m));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      const currentWorld = screenToWorld(cameraRef.current, { x: ev.clientX, y: ev.clientY });
      setMarquee(null);
      const rect = normalizeRect(startWorld, currentWorld);
      if (rect.width > 0 || rect.height > 0) {
        onCommitRef.current(rect, ev.shiftKey);
      }
    };
    const onCancel = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onEscape);
      setMarquee(null);
    };
    const onEscape = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onEscape);
  }, []);

  const rect = marquee ? normalizeRect(marquee.startWorld, marquee.currentWorld) : null;
  return { active: marquee !== null, rect, begin };
}

/** The marquee rectangle, rendered in the world layer (world units). */
export function MarqueeRect({ rect }: { rect: Rect }) {
  return (
    <div
      data-testid="marquee"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: '1px solid #1565C0',
        background: 'rgba(21, 101, 192, 0.1)',
        pointerEvents: 'none',
      }}
    />
  );
}
