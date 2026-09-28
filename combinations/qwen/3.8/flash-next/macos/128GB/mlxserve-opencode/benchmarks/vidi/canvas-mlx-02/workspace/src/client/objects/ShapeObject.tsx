// A shape on the board (story 10): a rectangle, an ellipse or a diamond, with a
// label. It is a board object like a note and a text and gets its selection,
// moving, resizing, marquee, delete and undo from the story 7 machinery - this
// file adds none of it, only what a shape looks like and how its label is
// written.
//
// The graphics are one SVG stretched to the stored box: the box IS the object
// (the hit area, the connector's anchor, the resize handle positions all read
// the same x/y/width/height), so the shape can never drift away from where the
// board thinks it is.
//
// The label is HTML, not SVG text, laid out in a box inset from the shape and
// vertically centred, so it wraps the way text wraps everywhere else on this
// board and can be edited by the shared editor. Story 9's text object hides its
// text while the editor is open; a shape does the same thing with `visibility`,
// because a centred label and a caret in the same place cannot both be read.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { getShapeLabel } from '../../shared/objects/shape.ts';
import type { ShapeSnapshot } from '../../shared/objects/shape.ts';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_INSET_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LINE_HEIGHT,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
} from '../../shared/config.ts';
import { fitFontSize } from './StickyText.ts';
import { TextEditor } from './TextEditor.tsx';
import type { ObjectProps } from './registry.tsx';

const PALETTE_FALLBACK = '#f0f0f0';

function sizeOf(obj: ShapeSnapshot): { width: number; height: number } {
  const min = SHAPE_MIN_SIZE_WORLD;
  const width = typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width > 0 ? obj.width : min;
  const height = typeof obj.height === 'number' && Number.isFinite(obj.height) && obj.height > 0 ? obj.height : min;
  return { width, height };
}

// A stored colour is a palette NAME (shape.palette_names): it is looked up, and
// anything unknown falls back to a neutral colour rather than to nothing - a
// shape that lost its paint is a bug, a shape that vanished is worse.
function paint(names: Record<string, string>, name: string | undefined, fallback: string): string {
  if (typeof name === 'string' && Object.prototype.hasOwnProperty.call(names, name)) return names[name];
  return fallback;
}

export function ShapeObject(props: ObjectProps): React.JSX.Element {
  const { obj, doc, selected, editing, editable, onObjectPointerDown, onStartEdit, onEndEdit } = props;
  const shape = obj as ShapeSnapshot;
  const kind = shape.kind === 'ellipse' || shape.kind === 'diamond' ? shape.kind : 'rect';
  const { width, height } = sizeOf(shape);

  const fill = paint(SHAPE_FILL_COLORS, shape.fill, SHAPE_FILL_COLORS.white ?? PALETTE_FALLBACK);
  const stroke = paint(SHAPE_STROKE_COLORS, shape.stroke, SHAPE_STROKE_COLORS.dark ?? PALETTE_FALLBACK);

  const label = shape.label ?? '';
  const inset = SHAPE_LABEL_INSET_WORLD;
  const labelWidth = Math.max(1, width - inset * 2);
  const labelHeight = Math.max(1, height - inset * 2);

  // The same auto-fit the sticky note uses (story 2), on the label's own box:
  // re-run when the words or the box change, never on zoom - the world box and
  // the font scale together.
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState(20);
  // The height the fitted text actually takes, so the editor can be centred in
  // the same box the label is centred in and the caret does not jump.
  const [textHeight, setTextHeight] = useState(0);
  const measure = useCallback(() => {
    const el = measureRef.current;
    if (!el) return;
    el.style.width = `${labelWidth}px`;
    el.textContent = label;
    const result = fitFontSize(el, labelHeight);
    setTextHeight(el.scrollHeight);
    setFontPx((previous) => (previous === result.fontPx ? previous : result.fontPx));
  }, [label, labelWidth, labelHeight]);
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  const ytext = getShapeLabel(doc, obj.id);

  // The generic grab: select and drag through the shared gesture, and on a board
  // that cannot be edited the press is not swallowed, so panning over a shape
  // still pans.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!editable) return;
    e.stopPropagation();
    if (editing) return;
    onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || editing) return;
    e.stopPropagation();
    onStartEdit(obj.id);
  };

  return (
    <div
      role="group"
      aria-label={label === '' ? `${kind} shape` : label}
      data-testid={`shape-${obj.id}`}
      data-object-id={obj.id}
      data-shape-kind={kind}
      data-selected={selected}
      data-editable={editable}
      data-editing={editing}
      data-fill={shape.fill ?? ''}
      data-stroke={shape.stroke ?? ''}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        boxSizing: 'border-box',
        cursor: editing ? 'text' : 'move',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <svg
        data-testid={`shape-graphic-${obj.id}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        {kind === 'rect' ? (
          <rect
            data-testid={`shape-figure-${obj.id}`}
            x={SHAPE_STROKE_WIDTH_WORLD / 2}
            y={SHAPE_STROKE_WIDTH_WORLD / 2}
            width={Math.max(0, width - SHAPE_STROKE_WIDTH_WORLD)}
            height={Math.max(0, height - SHAPE_STROKE_WIDTH_WORLD)}
            rx={2}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        ) : null}
        {kind === 'ellipse' ? (
          <ellipse
            data-testid={`shape-figure-${obj.id}`}
            cx={width / 2}
            cy={height / 2}
            rx={Math.max(0, width / 2 - SHAPE_STROKE_WIDTH_WORLD / 2)}
            ry={Math.max(0, height / 2 - SHAPE_STROKE_WIDTH_WORLD / 2)}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        ) : null}
        {kind === 'diamond' ? (
          <polygon
            data-testid={`shape-figure-${obj.id}`}
            points={`${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
            strokeLinejoin="round"
          />
        ) : null}
      </svg>

      {/* The label, centred in the shape and clipped by it. */}
      <div
        data-testid={`shape-label-${obj.id}`}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: inset,
          top: inset,
          width: labelWidth,
          height: labelHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: `${fontPx}px`,
          lineHeight: SHAPE_LINE_HEIGHT,
          color: '#202020',
          textAlign: 'center',
          visibility: editing && editable ? 'hidden' : 'visible',
          pointerEvents: 'none',
        }}
      >
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal' }}>{label}</span>
      </div>

      {/* The off-screen measurer the fit reads; never painted. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -9999,
          left: -9999,
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'normal',
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: SHAPE_LINE_HEIGHT,
        }}
      />

      {editing && editable && ytext ? (
        <div
          data-testid={`shape-editor-box-${obj.id}`}
          style={{
            position: 'absolute',
            left: inset,
            top: inset + Math.max(0, (labelHeight - textHeight) / 2),
            width: labelWidth,
          }}
        >
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={fontPx}
            width={labelWidth}
            fontFamily={TEXT_FONT_FAMILY}
            lineHeight={SHAPE_LINE_HEIGHT}
            paddingPx={0}
            testId="shape-editor"
            ariaLabel="Shape label"
            onInput={measure}
            onEnd={(next) => onEndEdit(next)}
          />
        </div>
      ) : null}
    </div>
  );
}
