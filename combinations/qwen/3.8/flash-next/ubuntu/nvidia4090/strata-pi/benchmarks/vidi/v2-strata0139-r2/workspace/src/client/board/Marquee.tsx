import { useCallback, useRef, useState, type ReactNode } from "react";
import { objectsInRect, type ObjectSnapshot } from "../../shared/board-model";
import { normalizeRect, type Rect } from "../../shared/geometry";
import { MARQUEE_BORDER_COLOR, MARQUEE_FILL_COLOR } from "../../shared/config";
import type { Camera, Point } from "../canvas/camera";
import { screenToWorld } from "../canvas/camera";

/**
 * Shift+drag selection (`sel.marquee_ui`).
 *
 * Pressing Shift on empty board space and dragging draws a translucent
 * rectangle; on release every object lying **entirely** inside it joins the
 * selection. An object the rectangle merely touches, or that is only partly
 * inside, is not selected (TC-07, TC-32) — and an empty rectangle leaves the
 * selection exactly as it was.
 *
 * The rectangle is stored in **world** units, so zooming mid-drag (a wheel or a
 * pinch during the drag) cannot change what it selects.
 */

export interface MarqueeApi {
  /** The rectangle while dragging, in world units; `null` when idle. */
  readonly rect: Rect | null;
  /** Screen point of the press (relative to the viewport). */
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Release: select what is inside, and stop drawing. */
  end(): void;
  /** Cancelled: select nothing and stop drawing. */
  cancel(): void;
  /** Whether a marquee drag is in progress right now. */
  active(): boolean;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[], additive: boolean) => void,
  knownTypes?: readonly string[],
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  const originRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const draggingRef = useRef(false);

  // Latest values, so the release computes the selection against the board as
  // it is at that moment, not as it was when the drag began.
  const latest = useRef({ camera, snapshot, onSelect, knownTypes });
  latest.current = { camera, snapshot, onSelect, knownTypes };

  const draw = useCallback((next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  const begin = useCallback((screen: Point) => {
    if (!isPoint(screen)) return;
    const world = screenToWorld(latest.current.camera, screen);
    originRef.current = world;
    draggingRef.current = true;
    draw({ x: world.x, y: world.y, width: 0, height: 0 });
  }, [draw]);

  const move = useCallback(
    (screen: Point) => {
      const origin = originRef.current;
      if (!origin || !isPoint(screen)) return;
      draw(normalizeRect(origin, screenToWorld(latest.current.camera, screen)));
    },
    [draw],
  );

  const end = useCallback(() => {
    const box = rectRef.current;
    originRef.current = null;
    draggingRef.current = false;
    draw(null);
    if (!box) return;

    const current = latest.current;
    const ids = objectsInRect(current.snapshot, box, current.knownTypes);
    // An empty marquee changes nothing at all.
    if (ids.length === 0) return;
    current.onSelect(ids, true);
  }, [draw]);

  const cancel = useCallback(() => {
    originRef.current = null;
    draggingRef.current = false;
    draw(null);
  }, [draw]);

  return { rect, begin, move, end, cancel, active: () => draggingRef.current };
}

/** The rectangle itself, drawn in the world layer so it scales with the board. */
export function MarqueeRect({ rect }: { rect: Rect | null }): ReactNode {
  if (!rect || rect.width === 0 || rect.height === 0) return null;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: `${round(rect.x)}px`,
        top: `${round(rect.y)}px`,
        width: `${round(rect.width)}px`,
        height: `${round(rect.height)}px`,
        background: MARQUEE_FILL_COLOR,
        border: `1px solid ${MARQUEE_BORDER_COLOR}`,
        pointerEvents: "none",
      }}
    />
  );
}

function isPoint(value: Point | undefined): value is Point {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
