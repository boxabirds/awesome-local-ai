import type { JSX } from 'react';

import { TEXT_SIZE_NAMES, TEXT_SIZES, type TextSize } from '../../shared/config.js';

/**
 * The toolbar of one selected text object (`src/client/objects/TextToolbar.tsx`).
 *
 * A sticky note owns its toolbar - the colour swatches are part of the note, and a
 * note is a thing with a surface. A piece of text is not: what you do to it is
 * make it bigger or smaller, and remove it. So its controls are the board's
 * selection bar showing this toolbar in place of the "n selected" count, which
 * means one toolbar for the selection whatever is in it rather than a floating
 * strip on top of every object type.
 *
 * The four sizes are the four names of {@link TEXT_SIZES} and nothing else: a
 * slider would ask the board to store a font size per text object, and the story
 * asks for four. One of them is always pressed - a text object has a size, there
 * is no "no size" - and clicking one is a request the parent carries out (set the
 * size, then let the box be measured again), because the toolbar that asks for a
 * bigger font cannot know how many lines the text will end up needing.
 */

export interface TextToolbarProps {
  /** The size the text object has now. */
  size: TextSize;
  /** Make the text this size. */
  onSize(size: TextSize): void;
  /** Remove the selection this toolbar belongs to. */
  onDelete(): void;
}

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div
      className="text-toolbar"
      role="toolbar"
      aria-label="Text"
      data-testid="text-toolbar"
      data-size={size}
    >
      {TEXT_SIZE_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="text-toolbar-size"
          data-testid="text-size-button"
          data-size={name}
          // The point size in the accessible name, because "S" and "L" on their own
          // say nothing about which is bigger to somebody who cannot see them - and
          // the button's own face is drawn at that size, which is not something a
          // screen reader can read off.
          aria-label={`Text size ${name} (${TEXT_SIZES[name]})`}
          title={`Make the text ${name}`}
          aria-pressed={size === name ? 'true' : 'false'}
          onClick={() => onSize(name)}
        >
          {name}
        </button>
      ))}
      {/* The same delete the selection bar has, under the same name: whatever is
          selected, this is the button that removes it. */}
      <button
        type="button"
        className="selection-delete"
        data-testid="selection-delete"
        aria-label="Delete selection"
        title="Delete selection (Delete)"
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}

export default TextToolbar;
