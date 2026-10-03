// The toolbar for exactly one selected text object (story 9, text.object): four size
// presets (S / M / L / XL) whose pressed state reflects the object's current size, plus
// a Delete button. It is shown by the `SelectionBar` — the one place the board already
// puts controls for the current selection — rather than by each object, so a board with
// twenty text objects still has a single toolbar on screen.
//
// It is deliberately dumb: it reports the chosen size and a delete and writes nothing
// itself. `onSize` is the caller's one undoable action (set the size preset, then
// re-measure the box); `onDelete` goes through the shared `deleteObjects`, because the
// design's "Delete uses the same delete path as any other object" rules out a
// text-only delete.

import type { CSSProperties } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

/** The four size presets, in the order the toolbar shows them. */
export const TEXT_SIZE_ORDER = Object.keys(TEXT_SIZES) as TextSize[];

export interface TextToolbarProps {
  /** The selected text object's current size preset. */
  size: TextSize;
  /** Switch to `size` (the caller writes the size and re-measures the box). */
  onSize(size: TextSize): void;
  /** Delete the selected object via the shared delete path. */
  onDelete(): void;
}

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  const btn = (active: boolean): CSSProperties => ({
    padding: '4px 8px',
    border: '1px solid #d0d3da',
    background: active ? '#dfe6ff' : '#fff',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 700 : 400,
    whiteSpace: 'nowrap',
  });

  return (
    <div
      role="toolbar"
      aria-label="Text"
      data-testid="text-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #e2e4ea',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
      }}
    >
      {TEXT_SIZE_ORDER.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key}
          title={`Text size ${key}`}
          aria-pressed={key === size}
          data-testid={`text-size-${key}`}
          onClick={() => onSize(key)}
          style={btn(key === size)}
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete"
        title="Delete this text"
        data-testid="text-delete"
        onClick={onDelete}
        style={{ ...btn(false), color: '#c0392b' }}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
