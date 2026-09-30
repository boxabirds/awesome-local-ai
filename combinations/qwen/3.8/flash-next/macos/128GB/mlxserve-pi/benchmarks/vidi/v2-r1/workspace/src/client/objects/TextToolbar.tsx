// The tools a single selected piece of text has (`text_ui`, `tool_ui`).
//
// Story 2 put a toolbar on each note; story 7 moved those tools to one bar above the
// board and gave a lone sticky note its colours. A lone piece of text gets this
// instead: the four sizes, and the same bin. There is deliberately no colour and no
// font picker — a text object has no colour of its own and one family for the whole
// board, so there is nothing to choose and no button that would do nothing.
//
// The four sizes are the whole of what can be picked, they are labelled `S`, `M`,
// `L`, `XL` and the board's four font sizes are behind the names (`TEXT_SIZES`). The
// size that is current is pressed; clicking another one keeps the object exactly
// where it is and re-measures its box (`applyTextSize`).
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import { type CSSProperties, type ReactNode } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The object's current size. An unknown value presses nothing. */
  size: TextSize;
  /** Asked for a different size. The board does the model call and the re-measure. */
  onSize(size: TextSize): void;
  onDelete(): void;
}

const ORDER = Object.keys(TEXT_SIZES) as TextSize[];

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  backgroundColor: 'rgba(255, 255, 255, 0.96)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
};

const sizeButtonStyle = (active: boolean): CSSProperties => ({
  minWidth: 26,
  padding: '2px 6px',
  fontSize: 13,
  fontFamily: 'var(--vidi6-font)',
  border: active ? '2px solid #1f2328' : '1px solid #d0d7de',
  borderRadius: 4,
  backgroundColor: active ? '#eef2f7' : '#ffffff',
  cursor: 'pointer',
});

const deleteButtonStyle: CSSProperties = {
  padding: '2px 8px',
  fontSize: 13,
  fontFamily: 'var(--vidi6-font)',
  border: '1px solid #d0d7de',
  borderRadius: 4,
  backgroundColor: '#ffffff',
  color: '#c0392b',
  cursor: 'pointer',
};

/**
 * The size buttons, in the order they appear: smallest to biggest, which is also
 * the order of their shortcut-free labels.
 */
export const TEXT_SIZE_ORDER: readonly TextSize[] = ORDER;

/** Floating toolbar for one selected text object. */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): ReactNode {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
      style={barStyle}
      onPointerDown={(event) => {
        // Never start an object drag or clear the selection from the toolbar.
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {ORDER.map((name) => (
        <button
          key={name}
          type="button"
          data-testid={`text-size-${name}`}
          aria-label={`Text size ${name}`}
          aria-pressed={name === size}
          title={`${name} (${TEXT_SIZES[name]} board units)`}
          style={sizeButtonStyle(name === size)}
          onClick={() => {
            onSize(name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        data-testid="delete-selection"
        aria-label="Delete selection"
        title="Delete this text"
        style={deleteButtonStyle}
        onClick={() => {
          onDelete();
        }}
      >
        Delete
      </button>
    </div>
  );
}
