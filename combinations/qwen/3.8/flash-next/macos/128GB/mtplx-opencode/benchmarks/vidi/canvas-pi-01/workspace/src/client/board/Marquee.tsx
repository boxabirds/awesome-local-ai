/**
 * Story 7 · task 11 — the Shift+drag marquee (design "Marquee selection").
 *
 * A drag that starts on empty board space while Shift is held draws a
 * translucent rectangle; releasing it selects the objects lying *entirely*
 * inside the rectangle. The rectangle is kept in world units, so zooming
 * mid-drag cannot distort it: the two live screen corners are converted to
 * world space with `screenToWorld` before being normalised, and the fully-inside
 * test (`objectsInRect`) runs in world space too.
 *
 * A marquee is a *selection*, not a pan: an ordinary drag (no Shift) still
 * pans the board (story 1, unchanged). Esc, `pointercancel` or lost pointer
 * capture cancels the marquee and leaves the selection exactly as it was.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

export interface Marquee {
  /** The live rectangle in world units, or `null` when no marquee is running. */
  rect: Rect | null;
  /** True while a marquee drag is in progress (used to route pointer moves). */
  isActive(): boolean;
  /** Start a marquee at a screen point (Shift was held on pointerdown). */
  begin(screen: Point): void;
  /** Extend the marquee to a screen point. */
  move(screen: Point): void;
  /**
   * Finish and select the objects entirely inside the rectangle. `additive`
   * unions with the current selection (Shift released before pointerup keeps it
   * additive; we always marquee additively so a plain box-select grows a set).
   * Returns the ids to select (empty leaves the selection unchanged).
   */
  end(snapshot: readonly ObjectSnapshot[]): string[];
  /** Abandon the marquee; the next gesture starts clean. */
  cancel(): void;
}

/**
 * Build the marquee controller. The camera is read through a getter so a
 * single controller always converts with the current zoom (a mid-drag zoom
 * still maps correctly).
 */
export function useMarquee(getCamera: () => Camera): Marquee {
  const state = useMemo(() => ({ rect: null as Rect | null, start: null as Point | null }), []);

  return useMemo<Marquee>(() => {
    return {
      get rect() {
        return state.rect;
      },
      isActive: () => state.rect !== null,
      begin(screen: Point) {
        state.start = screen;
        // A fresh marquee starts as a zero-area rectangle at the pointer.
        state.rect = normalizeRect(screen, screen);
      },
      move(screen: Point) {
        if (state.start === null) return;
        const camera = getCamera();
        // Convert both corners to world before normalising so the rect is
        // zoom-independent (PRD sel.marquee / design).
        const startWorld = screenToWorld(camera, state.start);
        const nowWorld = screenToWorld(camera, screen);
        state.rect = normalizeRect(startWorld, nowWorld);
      },
      end(snapshot: readonly ObjectSnapshot[]) {
        const rect = state.rect;
        state.rect = null;
        state.start = null;
        if (rect === null) return [];
        return objectsInRect(snapshot, rect);
      },
      cancel() {
        state.rect = null;
        state.start = null;
      },
    };
  }, [getCamera, state]);
}

const MARQUEE_FILL = 'rgba(47, 111, 237, 0.12)';
const MARQUEE_STROKE = 'rgba(47, 111, 237, 0.9)';

/** The translucent selection rectangle, drawn in world space inside the layer. */
export function MarqueeRect({ rect }: { rect: Rect | null }): JSX.Element | null {
  if (rect === null || rect.width <= 0 || rect.height <= 0) return null;
  return (
    <div
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        backgroundColor: MARQUEE_FILL,
        outline: `1px solid ${MARQUEE_STROKE}`,
        pointerEvents: 'none',
      }}
    />
  );
}