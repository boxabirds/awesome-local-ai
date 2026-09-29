// The floating toolbar of a single selected text object (story 9 `text.object`):
// the four size presets S/M/L/XL (with the current one pressed) and Delete. Choosing
// a size calls `onSize`, which writes `setTextSize` and remeasures the box keeping the
// object's top-left fixed. It is rendered inside the board's selection bar area, so
// like every toolbar it stops its own pointer events from reaching the board.

import type { TextSize } from '../../shared/config.ts';
import { TEXT_SIZES } from '../../shared/config.ts';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

// The button's own label is drawn at roughly the preset's relative size, so the row
// reads as "small → large" without a legend.
const LABEL_PX: Record<TextSize, number> = { S: 11, M: 14, L: 18, XL: 22 };

export function TextToolbar(props: TextToolbarProps) {
  const stop = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) =>
    e.stopPropagation();
  return (
    <div
      data-testid="text-toolbar"
      role="group"
      aria-label="Text"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        userSelect: 'none',
      }}
    >
      {SIZE_KEYS.map((key) => {
        const active = props.size === key;
        return (
          <button
            key={key}
            type="button"
            aria-label={`Text size ${key}`}
            data-testid={`text-size-${key}`}
            title={`Text size ${key}`}
            aria-pressed={active}
            onClick={() => props.onSize(key)}
            style={{
              minWidth: 28,
              height: 28,
              border: active ? '2px solid #2f6fed' : '1px solid #d6d9de',
              borderRadius: 6,
              background: active ? '#eaf2ff' : '#ffffff',
              color: '#1c3d69',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: LABEL_PX[key],
              lineHeight: '24px',
            }}
          >
            A
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Delete text"
        data-testid="text-delete"
        title="Delete"
        onClick={props.onDelete}
        style={{
          width: 28,
          height: 28,
          border: '1px solid #d6d9de',
          borderRadius: 6,
          background: '#ffffff',
          color: '#a1160c',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: '26px',
        }}
      >
        <span aria-hidden>&#128465;</span>
      </button>
    </div>
  );
}
