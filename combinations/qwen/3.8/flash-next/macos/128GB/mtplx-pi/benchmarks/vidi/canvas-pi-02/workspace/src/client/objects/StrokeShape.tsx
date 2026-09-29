/**
 * One stroke, drawn (story 11, design §4.3, §4.5).
 *
 * There is exactly one place in the product that turns a stroke into path data,
 * and it is `buildStrokeRender` in the shared model. This component calls it and
 * paints the result; it does not build a `d`, does not remember a `d`, and has no
 * second copy for the preview layer. A live capture and the committed stroke that
 * replaces it go through this same component, which is *why* they can be relied
 * on to look the same: a difference between preview and commit is not possible
 * when there is one renderer.
 *
 * It is rendered inside the world layer, so everything here is in world units and
 * the layer's own `scale(zoom) translate(…)` does the rest. Two things follow,
 * and both are the reason for doing it this way:
 *
 *   - the stroke width needs no compensation, so it cannot drift from the zoom the
 *     rest of the board is at — the failure mode design §4.5 is about;
 *   - a zoom in the middle of a draw costs nothing, because the geometry under the
 *     pointer is in world units and was never a screen path to rebuild.
 *
 * A stroke has no fill: `fill` is `none` and stays `none`. The inside of a ring is
 * empty, which is what the PRD's drawing rule asks for.
 */
import { memo } from 'react';
import { PEN_COLORS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';
import { buildStrokeRender, strokeStyle, strokeWidthWorld } from '../../shared/objects/stroke';
import type { StrokeSnap } from '../../shared/objects/stroke';

export interface StrokeShapeProps {
  /** The stroke to draw: a committed one, or the live capture. */
  snap: StrokeSnap;
  /** The live stroke under the pointer: never interactive, never focusable. */
  preview?: boolean;
}

function StrokeShapeView({ snap, preview = false }: StrokeShapeProps) {
  const render = buildStrokeRender(snap);
  const style = strokeStyle(snap);
  // A dot drawn without moving the pointer still has to be *seen*, so the box is
  // never smaller than the ink's own tolerance; that is also what keeps a
  // one-pixel-tall line from being unclickable.
  const width = Math.max(snap.width, STROKE_SIMPLIFY_TOLERANCE_PX);
  const height = Math.max(snap.height, STROKE_SIMPLIFY_TOLERANCE_PX);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const color = PEN_COLORS[style.color] ?? PEN_COLORS.black;

  return (
    <div
      data-testid={preview ? 'stroke-preview' : `stroke-${snap.id}`}
      data-stroke-kind={render.kind}
      data-stroke-closed={render.ring ? 'true' : 'false'}
      data-stroke-crossed={render.selfCrossed ? 'true' : 'false'}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: snap.x,
        top: snap.y,
        width,
        height,
        // The ink answers to a click somewhere else (see `hitTestStroke`); the
        // drawing itself never intercepts one, so a stroke never hides the board.
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {/* The viewBox is the ink's own box, so the drawing scales with the board
          and the stroke width needs no compensation of its own. */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <path
          d={render.d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidthWorld(style.thickness)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * Memoised on the snapshot object: the document snapshot is rebuilt only when the
 * document changes, so a board of five hundred strokes re-draws the stroke that
 * changed instead of all five hundred (the 60 fps requirement of `pen.long_stroke`
 * is a requirement about re-rendering, not about path data).
 */
export const StrokeShape = memo(
  StrokeShapeView,
  (previous, next) => previous.snap === next.snap && previous.preview === next.preview,
);
