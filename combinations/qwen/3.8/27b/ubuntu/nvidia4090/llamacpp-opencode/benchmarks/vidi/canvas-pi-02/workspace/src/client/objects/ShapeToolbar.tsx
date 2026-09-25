/**
 * Shape/Connector toolbar (story 10, shape.toolbar).
 *
 * Shown when a single shape or connector is selected. For shapes, it
 * replaces the text toolbar (not alongside it). For connectors, it shows
 * a delete button.
 *
 * Shape toolbar: [fill swatches | stroke swatches]
 * Connector toolbar: [Delete]
 *
 * The toolbar uses the same fixed-position layout as the existing
 * SelectionBar, centred under the selection.
 */

import React from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/config';

interface ShapeToolbarProps {
  /** The selected shape's current fill colour. */
  fill: FillColor;
  /** The selected shape's current stroke colour. */
  stroke: StrokeColor;
  /** Change the shape's fill colour. */
  onFillChange: (color: FillColor) => void;
  /** Change the shape's stroke colour. */
  onStrokeChange: (color: StrokeColor) => void;
  /** Delete the shape. */
  onDelete: () => void;
  /** Is this a connector (shows delete only)? */
  isConnector?: boolean;
}

const FILL_ORDER: FillColor[] = ['none', 'white', 'blue', 'green', 'yellow', 'pink', 'grey'];
const STROKE_ORDER: StrokeColor[] = ['dark', 'blue', 'green', 'orange', 'red', 'grey'];

export function ShapeToolbar({
  fill,
  stroke,
  onFillChange,
  onStrokeChange,
  onDelete,
  isConnector,
}: ShapeToolbarProps) {
  return (
    <div
      data-testid="shape-toolbar"
      className="vidi6-selection-bar"
      style={{
        position: 'fixed',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: 'white',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 20,
      }}
    >
      {!isConnector && (
        <>
          {/* Fill swatches */}
          <div data-testid="fill-swatches" style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {FILL_ORDER.map((c) => (
              <button
                key={c}
                data-testid={`fill-${c}`}
                onClick={() => onFillChange(c)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  border: fill === c ? '2px solid #4285F4' : '1px solid #ccc',
                  background: c === 'none'
                    ? 'repeating-linear-gradient(45deg, #f5f5f5, #f5f5f5 2px, transparent 2px, transparent 4px), #fff'
                    : SHAPE_FILL_COLORS[c],
                  cursor: 'pointer',
                  padding: 0,
                }}
                title={`Fill: ${c}`}
                aria-label={`Fill: ${c}`}
              />
            ))}
          </div>
          <div style={{ width: 1, height: 16, background: '#e0e0e0' }} />
          {/* Stroke swatches */}
          <div data-testid="stroke-swatches" style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {STROKE_ORDER.map((c) => (
              <button
                key={c}
                data-testid={`stroke-${c}`}
                onClick={() => onStrokeChange(c)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  border: stroke === c ? '2px solid #4285F4' : '1px solid #ccc',
                  background: SHAPE_STROKE_COLORS[c],
                  cursor: 'pointer',
                  padding: 0,
                }}
                title={`Outline: ${c}`}
                aria-label={`Outline: ${c}`}
              />
            ))}
          </div>
        </>
      )}
      <div style={{ width: 1, height: 16, background: '#e0e0e0' }} />
      <button
        data-testid="delete-shape"
        onClick={onDelete}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          padding: '4px 8px',
          fontSize: 13,
          color: '#5f6368',
        }}
      >
        Delete
      </button>
    </div>
  );
}
