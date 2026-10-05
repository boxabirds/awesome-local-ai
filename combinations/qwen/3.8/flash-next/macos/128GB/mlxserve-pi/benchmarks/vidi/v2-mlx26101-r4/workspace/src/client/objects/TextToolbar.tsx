/**
 * The toolbar that floats above one selected piece of text: four sizes and a bin.
 *
 * It is the text's answer to a sticky note's colours, and it is deliberately not the same control. A note
 * is a fixed square, so what a person can change about it is what it looks like; a piece of free text has
 * no fill and no border to choose between, and the one thing worth asking about it is how big the letters
 * are. That is a choice of four rather than a wheel of six, so it is drawn as four labelled letters rather
 * than as four swatches whose size you have to guess before clicking one.
 *
 * The current size reads as pressed (`aria-pressed`), because a size that cannot be told from the others
 * afterwards is a size that has to be re-tried one by one to check. The accessible names say what each
 * button does and what it is called — "Text size L", not "L" — so the toolbar is usable by somebody who is
 * hearing it rather than looking at it, which is the same standard the note's swatches are held to.
 *
 * Like the note's, it is rendered in screen space (the object counter-scales it) so it stays the size of a
 * target worth hitting at every zoom, and it gets out of the way while the text is being typed into or
 * dragged.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { TEXT_SIZES } from '../../shared/config';
import type { TextSize } from '../../shared/config';

/** The four sizes, in the order they appear: small to large, which is the order of `TEXT_SIZES`. */
const SIZE_NAMES = Object.keys(TEXT_SIZES) as TextSize[];

const DELETE_LABEL = 'Delete text';

export interface TextToolbarProps {
  /** The text's current size, which is the button that reads as pressed. */
  size: TextSize;
  /** A size was chosen. The box comes with it: this is one change, not two. */
  onSize(size: TextSize): void;
  onDelete(): void;
  /**
   * Grey the whole thing out: on a board that could not be loaded this text is not yours to change. `App`
   * refuses the write whatever happens here; this is so the toolbar does not offer commands that go
   * nowhere.
   */
  disabled?: boolean;
}

export function TextToolbar({ size, onSize, onDelete, disabled = false }: TextToolbarProps): JSX.Element {
  /** A click here is a command, never a board gesture: no pan, no deselect, no drag. */
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text tools"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {SIZE_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="text-toolbar__size"
          data-testid={`text-size-${name}`}
          data-size={name}
          aria-label={`Text size ${name}`}
          aria-pressed={size === name}
          title={`Text size ${name}`}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onSize(name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className="text-toolbar__delete"
        data-testid="text-delete"
        aria-label={DELETE_LABEL}
        title={DELETE_LABEL}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onDelete();
        }}
      >
        {/* The same bin as the note's toolbar, drawn with borders rather than an icon font. */}
        <span className="note-toolbar__bin" aria-hidden="true" />
      </button>
    </div>
  );
}
