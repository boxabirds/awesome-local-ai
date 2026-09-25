/**
 * Toolbar of a single selected text object (anchor: text.size): S, M, L and XL size
 * buttons (current one pressed) and Delete. Like the note toolbar it never lets pointer
 * input reach the board or the object underneath. Keys do reach the board, so tool
 * shortcuts (V, T, N) keep working after a size click; board commands already ignore
 * Enter and Delete on buttons.
 */
import type { SyntheticEvent } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZE_ORDER = Object.keys(TEXT_SIZES) as TextSize[];

const SIZE_NAMES: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

/** Accessible name of a size button: announces the size. */
export function sizeLabel(size: TextSize): string {
  return `Size ${size}`;
}

export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }): React.JSX.Element {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text"
      data-testid="text-toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      {SIZE_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          className="text-size"
          aria-label={sizeLabel(s)}
          title={SIZE_NAMES[s]}
          aria-pressed={props.size === s}
          onClick={() => props.onSize(s)}
        >
          {s}
        </button>
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button type="button" className="note-delete" aria-label="Delete text" title="Delete text" onClick={props.onDelete}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
