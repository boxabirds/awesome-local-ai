import { PEN_COLORS } from '../../shared/config';
import { usePenTool, type PenToolArgs } from './usePenTool';

/**
 * The Pen tool on the board (`pen.draw`, `pen.options`, `pen.share`).
 *
 * Two things are drawn, both in screen space and both `pointer-events: none`,
 * because the press that draws is taken by the tool on `window`:
 *
 * - the **stroke in progress**, as a path rebuilt once per animation frame. It is
 *   local: it lives in this component's state and is never written to the document,
 *   so nobody else sees it (`pen.share`, TC-18). Its width is the chosen thickness
 *   multiplied by the zoom, which is what the finished stroke will be painted with
 *   at this zoom, so the line being drawn is the line that will be left behind.
 * - the **pen tip**: a round cursor the diameter of the thickness at this zoom
 *   (`pen.cursor`), so the colour and thickness chosen are visible before anything
 *   is drawn, and the point where the stroke will start is unambiguous.
 */
export type PenToolProps = PenToolArgs;

export function PenTool(props: PenToolProps) {
  const { preview, cursor, cursorSize } = usePenTool(props);
  const surface = props.surface;
  const colour = PEN_COLORS[props.color];

  return (
    <>
      {preview && surface ? (
        <svg
          className="pen-preview-layer"
          data-testid="pen-preview"
          width={surface.width}
          height={surface.height}
          aria-hidden="true"
        >
          <path
            className="pen-preview__path"
            data-testid="pen-preview-path"
            d={preview.d}
            stroke={colour}
            strokeWidth={preview.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {cursor ? (
        <span
          className="pen-cursor"
          data-testid="pen-cursor"
          data-thickness={props.thickness}
          data-color={props.color}
          aria-hidden="true"
          style={{
            left: `${cursor.x - cursorSize / 2}px`,
            top: `${cursor.y - cursorSize / 2}px`,
            width: `${cursorSize}px`,
            height: `${cursorSize}px`,
            backgroundColor: colour,
          }}
        />
      ) : null}
    </>
  );
}
