/**
 * The toolbar of the one selected text object: four sizes and a bin.
 *
 * It hangs off the selection rather than off the object, and that is a difference from a sticky note
 * worth explaining: a note carries its own toolbar, because a note is a finished thing whose tools are
 * part of it. A text object's tool is the same question every text in this product asks — how big is it
 * — and the answer is one bar with four buttons for whatever is selected, in the same place the board
 * puts a bar when there is something selected. The board renders it; this file only draws it and says
 * which size is the current one.
 *
 * Like every toolbar on this board it swallows the pointer: a press on a button is a person choosing a
 * size, and it must not also be a press on the board behind it — which would pan the view, or clear the
 * selection, and close the bar before the click landed.
 */

import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import { TEXT_SIZES, type TextSize } from '../../shared/config';

/** What each size preset is called, for the button that offers it. */
export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

/** The four size names, in toolbar order (the order of `TEXT_SIZES`). */
export const TEXT_SIZE_NAMES = Object.keys(TEXT_SIZES) as TextSize[];

export interface TextToolbarProps {
  /** The selected object's size: its button is the pressed one. */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): React.JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement> | ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  return (
    <div
      aria-label="Text toolbar"
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      onClick={stop}
      onDoubleClick={stop}
      onPointerCancel={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      {TEXT_SIZE_NAMES.map((name) => (
        <button
          key={name}
          aria-label={`${TEXT_SIZE_LABELS[name]} text`}
          aria-pressed={name === size}
          className={`text-size-button text-size-${name}`}
          data-testid={`text-size-${name}`}
          title={TEXT_SIZE_LABELS[name]}
          type="button"
          onClick={() => {
            onSize(name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        aria-label="Delete text"
        className="text-delete"
        data-testid="delete-text"
        title="Delete text"
        type="button"
        onClick={onDelete}
      >
        <span aria-hidden="true">🗑</span>
      </button>
    </div>
  );
}
