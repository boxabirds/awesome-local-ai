import type { CSSProperties } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export const TEXT_TOOLBAR_LABEL = 'Text';
export const DELETE_TEXT_LABEL = 'Delete text';

/** Tooltip per size button; the button's accessible name is its visible label (S, M, L, XL). */
export const TEXT_SIZE_TITLES: Record<TextSize, string> = {
  S: 'Small text',
  M: 'Medium text',
  L: 'Large text',
  XL: 'Extra large text',
};

const SIZES = Object.keys(TEXT_SIZES) as TextSize[];

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
  /** Screen-space position (the selection bar places it above the text). */
  style?: CSSProperties;
}

/** Floating toolbar for one selected text object: S, M, L, XL (current one pressed) and Delete. */
export function TextToolbar({ size, onSize, onDelete, style }: TextToolbarProps) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label={TEXT_TOOLBAR_LABEL}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          className="text-toolbar__size"
          title={TEXT_SIZE_TITLES[s]}
          aria-pressed={s === size}
          onClick={() => onSize(s)}
        >
          {s}
        </button>
      ))}
      <span className="note-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label={DELETE_TEXT_LABEL}
        title={DELETE_TEXT_LABEL}
        onClick={onDelete}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
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
