import type { JSX } from 'react';
import { TEXT_SIZE_LABELS, TEXT_SIZES, type TextSize, type TextWidthMode } from '../../shared/config';

export interface TextToolbarProps {
  /** Current size: its button is the pressed one. */
  size: TextSize;
  /** Current width mode: the toggle shows what the width is now. */
  mode: TextWidthMode;
  /** One press is one undo step; the object wraps the write in the boundaries. */
  onSize(size: TextSize): void;
  onMode(mode: TextWidthMode): void;
  onDelete(): void;
}

/** Size order: small to extra large, as the design's key points list them. */
const SIZE_ORDER: readonly TextSize[] = (Object.keys(TEXT_SIZES) as TextSize[]).sort(
  (a, b) => TEXT_SIZES[a] - TEXT_SIZES[b],
);

/**
 * The toolbar of the one selected text object: four size buttons, the auto/fixed
 * width toggle and a bin button. It is presented by the selection bar, the same
 * place the note toolbar is presented from, so it is drawn in screen coordinates
 * and stays the same size on the screen whatever the zoom is.
 *
 * It changes the size and the width mode and nothing else — not where the object
 * is, not what is selected — so the buttons only ever report state through
 * `aria-pressed`, which is also what lets a test read the state back.
 */
export function TextToolbar(props: TextToolbarProps): JSX.Element {
  const stop = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
  };
  const isFixed = props.mode === 'fixed';

  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
    >
      {SIZE_ORDER.map((size) => (
        <button
          key={size}
          type="button"
          className={`text-size-button text-size-button-${size}`}
          data-testid={`text-size-${size}`}
          aria-label={`${TEXT_SIZE_LABELS[size]} text`}
          title={`${TEXT_SIZE_LABELS[size]} text`}
          aria-pressed={size === props.size}
          onClick={() => {
            props.onSize(size);
          }}
        >
          {size}
        </button>
      ))}
      <button
        type="button"
        className="text-width-mode-button"
        data-testid="text-width-mode"
        // The name of this button is the thing it switches on, and does not change
        // when the mode does: a person pressing it twice would otherwise hear the
        // board announce a different control each time. `aria-pressed` carries the
        // state, the button face shows it, and the title says what pressing it
        // would do.
        aria-label="Fixed width"
        title={isFixed ? 'Width is fixed; click to wrap it to the text again' : 'Width fits the text; click to fix it at this width'}
        aria-pressed={isFixed}
        onClick={() => {
          props.onMode(isFixed ? 'auto' : 'fixed');
        }}
      >
        {isFixed ? 'Fixed' : 'Auto'}
      </button>
      <button
        type="button"
        className="text-delete-button"
        data-testid="text-delete-button"
        aria-label="Delete text"
        title="Delete text"
        onClick={() => {
          props.onDelete();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M2 3.5h10M5.5 3.5V2h3v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  );
}
