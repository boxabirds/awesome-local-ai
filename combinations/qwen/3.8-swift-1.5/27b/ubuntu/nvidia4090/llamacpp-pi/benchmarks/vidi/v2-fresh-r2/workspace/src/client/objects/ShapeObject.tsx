/**
 * Shape object component (story 10, shape.object).
 *
 * Renders a shape (rect / ellipse / diamond) at its persisted x/y/width/
 * height with its fill/stroke colours and a centred label. All pointer
 * interaction delegates to the generic transform gesture (move/resize).
 * Double-click opens the label in the inline editor (shape.editing); an
 * empty label is kept (shapes are not deleted when their label is cleared —
 * only text objects are).
 */

import { useCallback } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_DEFAULT_SIZE_WORLD,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/** Font size for shape labels (world units). */
const LABEL_FONT_PX = 13;
/** Label text colour (dark). */
const LABEL_COLOR = '#263238';

interface ShapeData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'rect' | 'ellipse' | 'diamond';
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  label: string;
}

/** The SVG geometry for a shape kind inside a w×h box. */
function shapeSvg(kind: ShapeData['kind'], w: number, h: number): JSX.Element {
  const common = {
    fill: 'currentColor' as const,
    stroke: 'transparent' as const,
  };
  switch (kind) {
    case 'rect':
      // 2px rounded corners (shape.object).
      return <rect width={w} height={h} rx={2} ry={2} {...common} />;
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
    case 'diamond':
      return (
        <polygon
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          {...common}
        />
      );
  }
}

export function ShapeObject(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, editing, canEdit = true, onObjectPointerDown, onStartEdit, onEndEdit, undo } = props;
  const shape = obj as unknown as ShapeData;
  const width = shape.width ?? SHAPE_DEFAULT_SIZE_WORLD;
  const height = shape.height ?? SHAPE_DEFAULT_SIZE_WORLD;

  const fill = SHAPE_FILL_COLORS[shape.fill] ?? SHAPE_FILL_COLORS.white;
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] ?? SHAPE_STROKE_COLORS.dark;

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // Prevent board panning
      if (editing) return; // Don't start a gesture while editing
      onObjectPointerDown(e, shape.id);
    },
    [editing, shape.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (canEdit && !editing) {
        onStartEdit(shape.id);
      }
    },
    [shape.id, editing, canEdit, onStartEdit],
  );

  return (
    <div
      role="group"
      aria-label={`${shape.kind} shape`}
      data-testid="shape-object"
      data-shape-id={shape.id}
      data-shape-kind={shape.kind}
      data-selected={selected || undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width,
        height,
        cursor: editing ? 'text' : 'grab',
        outline: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
    >
      {editing ? (
        <TextEditor
          ytext={getShapeLabel(doc, shape.id)!}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={LABEL_FONT_PX}
          width="auto"
          textAlign="center"
          verticalAlign="center"
          ariaLabel="Shape label"
          testId="shape-label-textarea"
          onEnd={onEndEdit}
          undo={undo}
        />
      ) : (
        <>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
            aria-hidden="true"
          >
            <g
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
              strokeLinejoin="round"
            >
              {shapeSvg(shape.kind, width, height)}
            </g>
          </svg>
          {shape.label && (
            <div
              data-testid="shape-label"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                fontSize: `${LABEL_FONT_PX}px`,
                lineHeight: 1.3,
                color: LABEL_COLOR,
                padding: 8,
                overflow: 'hidden',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                pointerEvents: 'none',
              }}
            >
              {shape.label}
            </div>
          )}
        </>
      )}
    </div>
  );
}
