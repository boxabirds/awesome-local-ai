/**
 * The floating toolbar of the selected piece of text: four sizes, a width toggle, a bin.
 *
 * The sizes are the four presets and nothing else (`text.size`): a board where anybody can
 * type a point size into a box is a board where nobody's text matches anybody else's. Each
 * one says its name out loud in its accessible name as well as showing the letter, so the
 * choice is not carried by the glyph alone.
 *
 * **Fit width** is the state of the box, not a command: pressed means the box is as wide as
 * the words need and no more (`text.autosize`); released means the person gave it a width
 * by dragging it and the text wraps inside that (`text.resize_width`). It is in this toolbar
 * because a person who has dragged a column narrow and then wants it back needs the way out
 * to be where the problem was.
 *
 * The toolbar is shown whenever the text is selected, including while it is being typed
 * into — changing the size of the words you are writing is part of writing them.
 */
import { TEXT_SIZES, type TextSize, type TextWidthMode } from '../../shared/config';

/** What each preset is called, for the accessible name and the tooltip. */
const SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small text',
  M: 'Medium text',
  L: 'Large text',
  XL: 'Extra large text',
};

/** The four sizes, smallest first — the order the toolbar shows them in. */
const SIZE_ORDER: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

export interface TextToolbarProps {
  size: TextSize;
  widthMode: TextWidthMode;
  onSize(size: TextSize): void;
  onWidthMode(mode: TextWidthMode): void;
  onDelete(): void;
}

export function TextToolbar({ size, widthMode, onSize, onWidthMode, onDelete }: TextToolbarProps) {
  const stop = (event: React.SyntheticEvent) => {
    // Clicks here belong to the text, never to the board: they must not clear the
    // selection, end the edit that is in progress, or start a pan.
    event.stopPropagation();
  };
  const auto = widthMode === 'auto';

  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {SIZE_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className={`text-toolbar__size${name === size ? ' text-toolbar__size--active' : ''}`}
          // The letter is the affordance, and the size it stands for is what a screen
          // reader needs; `FONT_PX` is a world unit nobody can act on.
          aria-label={SIZE_LABELS[name]}
          aria-pressed={name === size}
          title={SIZE_LABELS[name]}
          style={{ fontSize: `${TEXT_SIZES[name] / 2}px` }}
          onPointerDown={stop}
          onClick={() => {
            onSize(name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className={`text-toolbar__width${auto ? ' text-toolbar__width--active' : ''}`}
        aria-label="Fit width"
        aria-pressed={auto}
        title={auto ? 'Width follows the text' : 'Width is fixed; click to fit the text again'}
        onPointerDown={stop}
        onClick={() => {
          onWidthMode(auto ? 'fixed' : 'auto');
        }}
      >
        Fit width
      </button>
      <button
        type="button"
        className="text-toolbar__delete"
        aria-label="Delete text"
        title="Delete text"
        onPointerDown={stop}
        onClick={() => {
          onDelete();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path
            d="M2.5 3.5h9M5.5 3.5V2h3v1.5M4 3.5l.6 8h4.8l.6-8M6 5.5v4M8 5.5v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
