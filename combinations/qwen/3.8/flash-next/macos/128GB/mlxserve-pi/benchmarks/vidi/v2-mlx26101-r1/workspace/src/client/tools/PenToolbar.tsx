// The pen's own toolbar: which ink, how thick a nib (story 11, pen.options).
//
// It appears next to the tool rail while the Pen tool is held and disappears with it, because a
// person cannot be drawing with a pen they cannot see the settings of. It is the only place in the
// app that writes the two pen settings, and it writes nothing else: picking a colour here changes
// the strokes that have not been drawn yet and touches none of the strokes that have (pen.options
// is a negative requirement as much as a positive one), so this component holds no document, no
// object id and no callback that could reach one.
//
// It sits above the pen's tool layer in the DOM on purpose. That layer covers the board and takes
// every press while the pen is held — which is how a stroke never pans the board — and a toolbar
// that came before it in the document would be under it and unclickable, which is how a person
// would be left holding a pen they could not put down.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  /** The pen that is chosen now: the swatch and the nib that say pressed. */
  color: PenColor;
  thickness: PenThickness;
  /** Draw in this colour from now on. */
  onColor(color: PenColor): void;
  /** Draw with this nib from now on. */
  onThickness(thickness: PenThickness): void;
}

/** The names the buttons are read by, in the order they are shown. */
const COLOR_NAMES = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];

/** 'thin' as a person would read it: 'Thin'. */
function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The pens, in six inks and three nibs. */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  // A press on the toolbar is a choice of pen and nothing else: it must not reach the board
  // underneath as a stroke.
  const stop = (e: ReactPointerEvent) => e.stopPropagation();

  const swatch = (active: boolean): CSSProperties => ({
    width: 24,
    height: 24,
    padding: 0,
    border: '1px solid #d0d3da',
    borderRadius: '50%',
    cursor: 'pointer',
    // The pressed pen is ringed rather than ticked: the ring is the colour's own outline, so a
    // swatch stays the only way to see what the ink looks like.
    boxShadow: active ? '0 0 0 2px #ffffff, 0 0 0 4px #4b6ef7' : 'none',
  });

  const nib = (active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 26,
    padding: '0 6px',
    border: '1px solid #d0d3da',
    borderRadius: 6,
    background: active ? '#dfe6ff' : '#fff',
    color: '#202124',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      aria-orientation="vertical"
      onPointerDown={stop}
      style={{
        position: 'fixed',
        left: 84,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: '#fff',
        border: '1px solid #e2e4ea',
        borderRadius: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${name} pen`}
          title={`Draw in ${name}`}
          aria-pressed={color === name}
          data-testid={`pen-color-${name}`}
          data-pen-color={name}
          onPointerDown={stop}
          onClick={() => onColor(name)}
          style={{ ...swatch(color === name), background: PEN_COLORS[name] }}
        />
      ))}
      {THICKNESS_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={label(name)}
          title={`Draw a ${label(name).toLowerCase()} line`}
          aria-pressed={thickness === name}
          data-testid={`pen-thickness-${name}`}
          data-pen-thickness={name}
          onPointerDown={stop}
          onClick={() => onThickness(name)}
          style={nib(thickness === name)}
        >
          {/* The nib itself, at its own thickness in board units: two pixels, four, eight. The
              only honest picture of a line width is a line of that width. */}
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              width: 14,
              height: PEN_THICKNESS_WORLD[name],
              borderRadius: 4,
              background: PEN_COLORS[color],
            }}
          />
          {label(name)}
        </button>
      ))}
    </div>
  );
}
