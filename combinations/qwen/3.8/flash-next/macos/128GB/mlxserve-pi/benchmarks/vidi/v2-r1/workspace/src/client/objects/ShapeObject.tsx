// A shape: a rectangle, an ellipse or a diamond with a label in the middle of it
// (`shape.ui`, `shape.label`).
//
// Three things about this component are the story, and one of them is only visible in
// the CSS:
//
//   - **The shape is drawn in board units, not in pixels.** Everything here is sized in
//     the world's own units and the world layer's CSS `scale()` turns it into pixels,
//     which is what makes a 200 × 120 drag come out 200 × 120 board units at any zoom
//     (TC-23), and why the outline is `SHAPE_STROKE_WIDTH_WORLD` *board* units thick
//     rather than a hairline that stays thin however far you go in.
//
//   - **The label's box is the shape, and the shape's box is what you resize.** The
//     label is laid out in a box as wide and as tall as the shape and centred in it, so
//     resizing re-wraps it and it stays in the middle (TC-24) — there is no second
//     measurement to keep in step, no height to recompute, no position to re-centre.
//     This is the one place story 10 is deliberately simpler than story 9: a shape's
//     text never changes the shape's size, so the box is not shared business and only
//     the shape's own numbers are ever written.
//
//   - **The label is a shared `Y.Text`, edited with story 2's editor.** Everything hard
//     about typing into a shared object — remote inserts, composition, the 500 character
//     limit, the undo that belongs to the board — is in `TextEditor`, and a shape gets
//     it by handing over its own limit and its own box.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import { SHAPE_LABEL_FONT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_WIDTH_WORLD } from '../../shared/config';
import {
  getShapeLabel,
  shapeFillCss,
  shapeStrokeCss,
  type ShapeSnapshot,
} from '../../shared/objects/shape';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../../shared/config';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/** What a shape's label says while you are typing in an empty shape. */
export const SHAPE_PLACEHOLDER = 'Label';

/** What a shape is handed: the props every object gets, with the shape spelled out. */
export interface ShapeObjectProps extends Omit<ObjectProps, 'object'> {
  shape: ShapeSnapshot;
}


export function ShapeObject({
  shape,
  doc,
  selected,
  editing,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undo,
}: ShapeObjectProps): ReactNode {
  const label: Y.Text | undefined = editing ? getShapeLabel(doc, shape.id) : undefined;
  const fill = shapeFillCss(shape.fill);
  const stroke = shapeStrokeCss(shape.stroke);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable || editing || event.button !== 0) return;
    // The board does not pan, marquee or click-clear underneath a shape.
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Selecting, raising and moving belong to the generic gesture, as they do for a
    // note or a piece of text.
    onObjectPointerDown(event.nativeEvent, shape.id);
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!editable) return;
    // A double-click on a shape labels it; on the board behind it, it would create one.
    event.stopPropagation();
    if (!editing) onStartEdit(shape.id);
  };

  return (
    <div
      data-testid="shape-object"
      data-id={shape.id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      role="group"
      aria-label={LABEL_OF[shape.kind] ?? 'Shape'}
      aria-roledescription={editable ? LABEL_OF[shape.kind] : `${LABEL_OF[shape.kind]} (read-only board)`}
      tabIndex={0}
      style={boxStyle(shape)}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <svg
        data-testid="shape-object-svg"
        aria-hidden="true"
        style={svgStyle}
        width={shape.width}
        height={shape.height}
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        focusable="false"
      >
        {shape.kind === 'ellipse' ? (
          <ellipse
            cx={shape.width / 2}
            cy={shape.height / 2}
            rx={Math.max(0, shape.width / 2 - SHAPE_STROKE_WIDTH_WORLD / 2)}
            ry={Math.max(0, shape.height / 2 - SHAPE_STROKE_WIDTH_WORLD / 2)}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        ) : shape.kind === 'diamond' ? (
          <polygon
            points={diamondPoints(shape.width, shape.height)}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
            strokeLinejoin="round"
          />
        ) : (
          <rect
            x={SHAPE_STROKE_WIDTH_WORLD / 2}
            y={SHAPE_STROKE_WIDTH_WORLD / 2}
            width={Math.max(0, shape.width - SHAPE_STROKE_WIDTH_WORLD)}
            height={Math.max(0, shape.height - SHAPE_STROKE_WIDTH_WORLD)}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
      </svg>

      {/* The label, in a box exactly the size of the shape: centred in it, and wrapped
          to it. `key` on the wrapper is what re-wraps the text when the shape's width
          changes under it — the box is laid out again and so is every line in it. */}
      <div
        data-testid="shape-object-label"
        key={`${shape.width}x${shape.height}`}
        aria-hidden={editing ? 'true' : undefined}
        style={{
          ...labelStyle,
          color: stroke,
          visibility: editing && shape.label.length === 0 ? 'hidden' : 'visible',
        }}
      >
        <span style={ labelTextStyle}>{shape.label}</span>
      </div>

      {label ? (
        <div style={editorBoxStyle}>
          <TextEditor
            ytext={label}
            fontPx={SHAPE_LABEL_FONT_SIZE_WORLD}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            lineHeight={TEXT_LINE_HEIGHT}
            fontFamily={TEXT_FONT_FAMILY}
            ariaLabel="Shape label"
            testId="shape-object-editor"
            containerSelector='[data-testid="shape-object"]'
            // Escape leaves the shape selected; a press somewhere else has already
            // decided what is selected, and must not be fought over.
            onEnd={onEndEdit}
            undo={undo}
          />
          {shape.label.length === 0 ? (
            <span data-testid="shape-object-placeholder" aria-hidden="true" style={placeholderStyle}>
              {SHAPE_PLACEHOLDER}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const LABEL_OF: Record<string, string> = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond' };

/**
 * The four points of a diamond in a box of `width` by `height`, pulled in by half the
 * outline's thickness so the stroke stays inside the box the object owns.
 */
export function diamondPoints(width: number, height: number): string {
  const inset = SHAPE_STROKE_WIDTH_WORLD / 2;
  return [
    `${width / 2},${inset}`,
    `${width - inset},${height / 2}`,
    `${width / 2},${height - inset}`,
    `${inset},${height / 2}`,
  ].join(' ');
}

const boxStyle = (shape: ShapeSnapshot): CSSProperties => ({
  position: 'absolute',
  left: shape.x,
  top: shape.y,
  width: shape.width,
  height: shape.height,
  boxSizing: 'border-box',
  // The world layer takes its children out of the pointer's way; each object puts
  // itself back in.
  pointerEvents: 'auto',
  cursor: 'grab',
  userSelect: 'none',
  touchAction: 'none',
});

const svgStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  display: 'block',
  // The outline is drawn to the box, and the box is the shape: nothing outside it.
  overflow: 'visible',
  pointerEvents: 'none',
};

const labelStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  overflow: 'hidden',
  // The label is what you read; the shape behind it is what you grab.
  pointerEvents: 'none',
  fontFamily: TEXT_FONT_FAMILY,
  fontWeight: 500,
};

const labelTextStyle: CSSProperties = {
  // Board units, like everything else in the world layer: the label is the same size
  // relative to its shape at 25% and at 400%, and resizing a shape never rescales its
  // text - it re-wraps it.
  fontSize: SHAPE_LABEL_FONT_SIZE_WORLD,
  lineHeight: String(TEXT_LINE_HEIGHT),
  whiteSpace: 'pre-wrap',
  // A word too long for a line of its own breaks where the line ends, which is what
  // makes a long label wrap inside a narrow shape instead of running out of it.
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  // A label longer than the shape is clipped by the box rather than drawn over the
  // board: the limit is 500 characters, which is more than any shape fits at 100%.
  maxHeight: '100%',
};

const editorBoxStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  pointerEvents: 'auto',
};

const placeholderStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: '50%',
  transform: 'translateY(-50%)',
  textAlign: 'center',
  fontFamily: TEXT_FONT_FAMILY,
  fontSize: `${SHAPE_LABEL_FONT_SIZE_WORLD}px`,
  lineHeight: String(TEXT_LINE_HEIGHT),
  color: '#1f2328',
  opacity: 0.35,
  pointerEvents: 'none',
};
