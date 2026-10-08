import React from 'react'
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config'

export interface ShapeToolbarProps {
  fill: FillColor
  stroke: StrokeColor
  onFill(c: FillColor): void
  onStroke(c: StrokeColor): void
}

// Design order: 6 colours + "no fill".
const FILL_ORDER: FillColor[] = ['white', 'blue', 'green', 'yellow', 'pink', 'grey', 'none']
const STROKE_ORDER: StrokeColor[] = ['dark', 'blue', 'green', 'orange', 'red', 'grey']

function Swatch({
  colorKey,
  hex,
  kind,
  active,
  onPick,
}: {
  colorKey: string
  hex: string
  kind: 'fill' | 'outline'
  active: boolean
  onPick(c: string): void
}) {
  const label = `${colorKey} ${kind}`
  return (
    <button
      type="button"
      data-testid={`shape-${kind}-${colorKey}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={() => onPick(colorKey)}
      style={{
        width: 18,
        height: 18,
        padding: 0,
        marginRight: 2,
        borderRadius: 3,
        cursor: 'pointer',
        background: hex,
        border: active ? '2px solid #4285f4' : '1px solid rgba(0,0,0,0.35)',
        outline: 'none',
      }}
    />
  )
}

/**
 * Fill + outline swatch strip shown for a single selected shape. Clicking a
 * swatch calls the matching handler; the label/size/position/selection of the
 * shape are untouched (the model only edits fill/stroke keys).
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps) {
  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape style"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        background: 'rgba(255,255,255,0.98)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        whiteSpace: 'nowrap',
      }}
    >
      <span data-testid="shape-fill-group" style={{ display: 'flex', alignItems: 'center' }}>
        {FILL_ORDER.map(c => (
          <Swatch
            key={c}
            colorKey={c}
            hex={SHAPE_FILL_COLORS[c]}
            kind="fill"
            active={fill === c}
            onPick={k => onFill(k as FillColor)}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        style={{ width: 1, height: 18, background: 'rgba(0,0,0,0.15)', display: 'inline-block' }}
      />
      <span data-testid="shape-stroke-group" style={{ display: 'flex', alignItems: 'center' }}>
        {STROKE_ORDER.map(c => (
          <Swatch
            key={c}
            colorKey={c}
            hex={SHAPE_STROKE_COLORS[c]}
            kind="outline"
            active={stroke === c}
            onPick={k => onStroke(k as StrokeColor)}
          />
        ))}
      </span>
    </div>
  )
}