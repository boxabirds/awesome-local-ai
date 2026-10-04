import { useCallback } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import type { UndoController } from '../board/undo';
import type { EditEnd } from '../board/useSelection';
import { counterVisible, fitFontSize } from './StickyText';
import { TextEditor, type FontFit } from './TextEditor';

export type { EditEnd } from '../board/useSelection';

export interface StickyTextEditorProps {
  /** The note's text: the value that survives, written to on every input event. */
  ytext: Y.Text;
  /** Font size the note fitted before editing started; re-fitted as the text grows. */
  fontPx: number;
  /** Escape (stay selected) or a click outside (deselect). */
  onEnd(next: EditEnd): void;
  /**
   * This person's undo history. A spell of typing is one step rather than one per letter, and the
   * boundary of that step is known here and nowhere else - the editor knows when the note was
   * opened and when it was closed, and the history does not. While this textarea has the keyboard,
   * Ctrl/Cmd+Z is this note's typing going back, not the browser's own undo of the textarea.
   * Left out, the editor neither opens a step nor answers the key.
   */
  undo?: UndoController;
}

/** Height available for text: the note minus its padding (jsdom has no layout at all). */
function textBox(el: HTMLTextAreaElement): number {
  return el.clientHeight > 0 ? el.clientHeight : STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;
}

function clampFont(fontPx: number): number {
  if (!Number.isFinite(fontPx)) {
    return STICKY_FONT_MAX_PX;
  }
  return Math.min(STICKY_FONT_MAX_PX, Math.max(STICKY_FONT_MIN_PX, Math.round(fontPx)));
}

/**
 * The textarea that appears inside a note while it is being edited.
 *
 * The editing itself - writing every keystroke to the note's `Y.Text` as the difference it made,
 * showing a peer's change as it arrives, keeping the caret where it belongs through it, waiting for
 * Japanese input to finish, cutting a paste at the limit - is story 9's `TextEditor`, the same one a
 * free text object is typed into. What is left here is the three things a sticky note does with its
 * text and a text object does not:
 *
 * - it shrinks the font to fit, because a note is a fixed square and the text has to live in it
 *   (a text object takes a new line instead, and its four sizes are somebody's choice);
 * - it counts down to its own limit, `STICKY_TEXT_MAX_CHARS`, which is much shorter than a text
 *   object's because a note cannot grow to hold what is written in it;
 * - and it fades the bottom of the text when even the smallest font will not hold it.
 *
 * Editing rules that come from the note: the caret starts at the end of the existing text, Escape
 * keeps the note selected, a pointer press outside the note deselects it, and Enter inserts a
 * newline rather than closing the editor.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  undo,
}: StickyTextEditorProps): JSX.Element {
  const refit = useCallback((el: HTMLTextAreaElement): FontFit => fitFontSize(el, textBox(el)), []);

  return (
    <TextEditor
      ytext={ytext}
      fontPx={clampFont(fontPx)}
      onEnd={onEnd}
      undo={undo}
      maxLength={STICKY_TEXT_MAX_CHARS}
      hostAttribute="data-sticky-note"
      className="sticky-note__editor"
      testId="sticky-note-editor"
      ariaLabel="Sticky note text"
      refit={refit}
      render={({ value, overflow }) => (
        <>
          {counterVisible(value.length) ? (
            <div
              className="sticky-note__counter"
              data-testid="sticky-note-counter"
              data-length={value.length}
              role="status"
            >
              {`${value.length}/${STICKY_TEXT_MAX_CHARS}`}
            </div>
          ) : null}
          {overflow ? (
            <div
              className="sticky-note__fade"
              data-testid="sticky-note-fade"
              data-overflow="true"
              aria-hidden="true"
            />
          ) : null}
        </>
      )}
    />
  );
}
