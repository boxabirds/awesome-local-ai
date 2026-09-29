/**
 * Story 9 · task 8 — the text toolbar (design "TextToolbar in SelectionBar").
 *
 * Shown for **exactly one** selected text object (a group of two-or-more uses the
 * board-level selection bar instead). It offers the four font-size presets and a
 * Delete action. Each size button carries an accessible name and an
 * `aria-pressed` state marking the current size, so the choice is not colour-only
 * (PRD "Accessibility"). Pointer events are stopped so a click here never reaches
 * the board surface and clears the selection the toolbar depends on.
 */
import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The current size preset. */
  size: TextSize;
  /** Change the size (the parent runs it in an undo step and remeasures). */
  onSize(size: TextSize): void;
  /** Delete this text object. */
  onDelete(): void;
}

/** The four presets in display order (small → large). */
export const TEXT_SIZE_NAMES = Object.keys(TEXT_SIZES) as TextSize[];

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text actions"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {TEXT_SIZE_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="text-size"
          data-testid={`text-size-${name}`}
          aria-label={`${name} size`}
          aria-pressed={size === name}
          onPointerDown={stop}
          onClick={(event) => {
            event.stopPropagation();
            onSize(name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className="text-delete"
        data-testid="text-delete"
        aria-label="Delete text"
        onPointerDown={stop}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}