// The pen toolbar (story 11 `pen.ui`): the six colours and three thicknesses the next
// stroke is drawn with.
//
// It is not an object toolbar: nothing is selected when it is on screen, because the pen
// is a *mode* — it appears when Pen is the active tool and goes away when another tool
// is, and it changes what the next stroke is, not what the last one was (pen.options).
// The pressed swatch is what the pen is set to now; choosing another one takes effect on
// the next stroke and leaves the strokes already on the board alone.
//
// Every button is named, so a test and a screen reader both find it by name:
// `button[aria-label="Black pen"]`, `button[aria-label="Thin"]`. The current colour is
// written out next to the swatches for the same reason.
//
// Like every toolbar it stops its own pointer, click and wheel events, so choosing a
// colour never draws a stroke on the board behind it.

import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config.ts';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const COLOR_KEYS = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESS_KEYS: PenThickness[] = ['thin', 'medium', 'thick'];

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const SWATCH: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: '1px solid rgba(0,0,0,0.2)',
  padding: 0,
  cursor: 'pointer',
};

/**
 * The pen's colour and thickness, in one small bar beside the board toolbar.
 */
export function PenToolbar(props: PenToolbarProps) {
  const stop = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) =>
    e.stopPropagation();
  const paint = PEN_COLORS[props.color];
  return (
    <div
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 8,
        padding: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
      }}
    >
      <span data-testid="pen-color-row" style={{ display: 'flex', gap: 4 }}>
        {COLOR_KEYS.map((name) => {
          const active = props.color === name;
          return (
            <button
              key={name}
              type="button"
              aria-label={`${label(name)} pen`}
              data-testid={`pen-color-${name}`}
              title={`${label(name)} pen`}
              aria-pressed={active}
              onClick={() => props.onColor(name)}
              style={{
                ...SWATCH,
                background: PEN_COLORS[name],
                outline: active ? '2px solid #2f6fed' : undefined,
                outlineOffset: 1,
              }}
            />
          );
        })}
      </span>
      <span aria-hidden style={{ width: 1, height: 20, background: '#d6d9de' }} />
      <span data-testid="pen-thickness-row" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {THICKNESS_KEYS.map((name) => {
          const active = props.thickness === name;
          return (
            <button
              key={name}
              type="button"
              aria-label={label(name)}
              data-testid={`pen-thickness-${name}`}
              title={label(name)}
              aria-pressed={active}
              onClick={() => props.onThickness(name)}
              style={{
                width: 26,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#ffffff',
                borderRadius: 6,
                border: active ? '1px solid #2f6fed' : '1px solid #d6d9de',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {/* The line is drawn at the thickness it means, in the colour in use. */}
              <span
                aria-hidden
                style={{
                  width: 16,
                  height: Math.max(2, PEN_THICKNESS_WORLD[name]),
                  borderRadius: 999,
                  background: paint,
                  display: 'block',
                }}
              />
            </button>
          );
        })}
      </span>
      <span aria-hidden style={{ width: 1, height: 20, background: '#d6d9de' }} />
      <span
        data-testid="pen-current-color"
        style={{ fontSize: 12, color: '#5f6368', minWidth: 44, textAlign: 'center' }}
      >
        {label(props.color)}
      </span>
    </div>
  );
}
