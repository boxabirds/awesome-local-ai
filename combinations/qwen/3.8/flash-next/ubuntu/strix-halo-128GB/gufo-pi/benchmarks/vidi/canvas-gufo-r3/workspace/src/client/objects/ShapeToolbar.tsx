import React, { useCallback } from 'react';
import * as Y from 'yjs';
import type { ShapeSnap } from '@shared/board-model';
import type { UndoController } from '@client/board/undo';
import { setShapeStyle } from '@shared/objects/shape';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  FILL_COLOR_NONE,
  type FillColor,
  type StrokeColor,
} from '@shared/config';

const FILL_LABELS: Record<FillColor, string> = {
  none: 'No fill',
  white: 'White fill',
  blue: 'Blue fill',
  green: 'Green fill',
  yellow: 'Yellow fill',
  pink: 'Pink fill',
  grey: 'Grey fill',
};

const STROKE_LABELS: Record<StrokeColor, string> = {
  dark: 'Dark outline',
  blue: 'Blue outline',
  green: 'Green outline',
  orange: 'Orange outline',
  red: 'Red outline',
  grey: 'Grey outline',
};

export interface ShapeToolbarProps {
  doc: Y.Doc;
  shape: ShapeSnap;
  undoController?: UndoController | null;
}

/**
 * Contextual style toolbar for a single selected shape: six fills plus 'none',
 * and six outline colours. aria-labels are "<colour> fill" / "<colour> outline".
 * Applying a colour touches only that key; the label is never modified.
 */
export function ShapeToolbar({ doc, shape, undoController }: ShapeToolbarProps): React.ReactElement {
  const applyFill = useCallback(
    (fill: FillColor) => {
      undoController?.boundary();
      setShapeStyle(doc, shape.id, { fill });
      undoController?.boundary();
    },
    [doc, shape.id, undoController],
  );

  const applyStroke = useCallback(
    (stroke: StrokeColor) => {
      undoController?.boundary();
      setShapeStyle(doc, shape.id, { stroke });
      undoController?.boundary();
    },
    [doc, shape.id, undoController],
  );

  return (
    <div
      role="toolbar"
      aria-label="Shape style"
      data-testid="shape-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: -44,
        left: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        background: '#FFFFFF',
        border: '1px solid #D0D0D0',
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((name) => (
        <button
          key={`fill-${name}`}
          type="button"
          aria-label={FILL_LABELS[name]}
          data-testid={`shape-fill-${name}`}
          aria-pressed={shape.fill === name}
          onClick={() => applyFill(name)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 3,
            cursor: 'pointer',
            background: name === FILL_COLOR_NONE ? 'repeating-linear-gradient(45deg,#fff,#fff 4px,#ddd 4px,#ddd 8px)' : SHAPE_FILL_COLORS[name],
            border: shape.fill === name ? '2px solid #1976D2' : '1px solid #9E9E9E',
            padding: 0,
          }}
        />
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 20, background: '#D0D0D0', margin: '0 4px' }} />
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((name) => (
        <button
          key={`stroke-${name}`}
          type="button"
          aria-label={STROKE_LABELS[name]}
          data-testid={`shape-stroke-${name}`}
          aria-pressed={shape.stroke === name}
          onClick={() => applyStroke(name)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 3,
            cursor: 'pointer',
            background: '#FFFFFF',
            border: `3px solid ${SHAPE_STROKE_COLORS[name]}`,
            outline: shape.stroke === name ? '2px solid #1976D2' : 'none',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
