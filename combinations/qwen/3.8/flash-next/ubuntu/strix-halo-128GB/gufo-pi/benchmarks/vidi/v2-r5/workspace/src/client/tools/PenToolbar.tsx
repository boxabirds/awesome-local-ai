import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/**
 * Pen options toolbar: six colour swatches and three thickness buttons.
 * Visible only while the Pen tool is active.
 */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  const stop = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      {Object.entries(PEN_COLORS).map(([key, hex]) => (
        <button
          key={key}
          type="button"
          className="pen-toolbar-swatch"
          data-testid={`pen-color-${key}`}
          aria-label={`${key} pen`}
          aria-pressed={color === key}
          onClick={() => onColor(key as PenColor)}
          style={{
            backgroundColor: hex,
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: color === key ? '2px solid #000' : '1px solid #ccc',
            cursor: 'pointer',
          }}
        />
      ))}
      <div style={{ width: 1, height: 20, backgroundColor: '#ccc', margin: '0 4px' }} />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((key) => (
        <button
          key={key}
          type="button"
          className="pen-toolbar-thickness"
          data-testid={`pen-thickness-${key}`}
          aria-label={THICKNESS_LABELS[key]}
          aria-pressed={thickness === key}
          onClick={() => onThickness(key)}
          style={{
            cursor: 'pointer',
            padding: '2px 6px',
            border: thickness === key ? '2px solid #000' : '1px solid #ccc',
            borderRadius: 4,
            background: thickness === key ? '#e0e0e0' : '#fff',
          }}
        >
          {THICKNESS_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
