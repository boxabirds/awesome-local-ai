/**
 * The bar that floats above the selection (`sel.bar`).
 *
 * Two or more objects selected: "N selected" and one Delete button for all of them.
 * Exactly one sticky note: story 2's note toolbar instead — colours and a bin — because
 * that is what a person reaching for one note's tools expects, and the design says so.
 * Exactly one piece of text: its own toolbar — four sizes, the width toggle, a bin
 * (`text.size`, `text.autosize`, `text.resize_width`).
 * Anything else (one object of another type, nothing at all): no bar.
 *
 * The bar writes through the model, the way the note's colour does: one undo capture
 * window per click, and the box a size change implies is measured in the same breath, so
 * a person never sees text at one size inside a box measured for another.
 *
 * The *count* is what gets announced. `aria-live="polite"` on the text means a screen
 * reader hears "6 selected" when a marquee finishes or Ctrl+A runs, which is the only
 * way a person who cannot see the board learns what their gesture picked up. It is a
 * live region rather than a status dialog so it waits for the moment to be spoken.
 *
 * Where the bar sits is the caller's business: `App` positions it above the selection's
 * bounding box in screen space, which needs the camera, and this component stays a
 * plain piece of chrome that works out only *what* to show from what is selected.
 */
import type * as Y from 'yjs';

import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import { setStickyColor } from '../../shared/board-model';
import type { StickyColor, TextSize, TextWidthMode } from '../../shared/config';
import {
  setTextSize,
  setTextWidthAuto,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../shared/objects/text';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { remeasureTextBox } from '../objects/useTextBoxSync';

export interface SelectionBarProps {
  /** The selected ids. */
  ids: ReadonlySet<string>;
  /** What the board can draw — the bar describes objects, so it needs to see them. */
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  /** Delete everything selected, and clear the selection (`sel.group_delete`). */
  onDelete(): void;
  /**
   * Close the current undo capture window (`undo.steps`).
   *
   * A colour change is one step, whatever the pointer did around it. Two clicks on two
   * swatches within half a second would otherwise look like one burst of typing to the
   * history and merge into a single undo, which is not how a colour is chosen.
   */
  boundary?(): void;
}

/** The one selected object, when a single sticky note is all there is. */
function singleSticky(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): StickySnapshot | null {
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  const object = snapshot.find((candidate) => candidate.id === id);
  return object && object.type === 'sticky' ? (object as StickySnapshot) : null;
}

/** The one selected object, when a single piece of text is all there is. */
function singleText(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): TextSnapshot | null {
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  const object = snapshot.find((candidate) => candidate.id === id);
  return object && object.type === 'text' ? (object as TextSnapshot) : null;
}

export function SelectionBar(props: SelectionBarProps) {
  const { ids, snapshot, doc, onDelete } = props;
  if (ids.size === 0) return null;

  const text = singleText(ids, snapshot);
  if (text) {
    return (
      <div className="selection-bar selection-bar--text" data-testid="selection-bar">
        <TextToolbar
          size={text.size}
          widthMode={text.widthMode}
          onSize={(size: TextSize) => {
            props.boundary?.();
            setTextSize(doc, text.id, size);
            // Bigger words need a taller box, and the person should not have to type
            // something to find out.
            remeasureTextBox(doc, text.id);
            props.boundary?.();
          }}
          onWidthMode={(mode: TextWidthMode) => {
            props.boundary?.();
            if (mode === 'fixed') {
              // Keep the width it has and hold it there: the box the person is looking
              // at is the box they asked to keep (`text.resize_width`).
              setTextWidthFixed(doc, text.id, text.width);
            } else {
              setTextWidthAuto(doc, text.id);
            }
            remeasureTextBox(doc, text.id);
            props.boundary?.();
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  const note = singleSticky(ids, snapshot);
  if (note) {
    // One sticky note: its own toolbar, exactly as story 2 made it.
    return (
      <div className="selection-bar selection-bar--note" data-testid="selection-bar">
        <NoteToolbar
          color={note.color}
          onColor={(color: StickyColor) => {
            props.boundary?.();
            setStickyColor(doc, note.id, color);
            props.boundary?.();
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  if (ids.size < 2) return null;

  return (
    <div className="selection-bar" data-testid="selection-bar">
      {/* Announced when the selection changes: the count is the whole message. */}
      <span className="selection-bar__count" data-testid="selection-count" aria-live="polite">
        {`${ids.size} selected`}
      </span>
      <button
        type="button"
        className="selection-bar__delete"
        aria-label="Delete selection"
        title="Delete selection"
        onPointerDown={(event) => {
          // A press here belongs to the bar: it must not clear the selection it is
          // describing, or start a pan behind it.
          event.stopPropagation();
        }}
        onClick={onDelete}
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
