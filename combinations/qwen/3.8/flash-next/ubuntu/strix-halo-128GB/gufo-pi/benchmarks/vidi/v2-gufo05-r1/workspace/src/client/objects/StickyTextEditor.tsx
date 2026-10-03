/**
 * The text editor of a sticky note: a textarea whose contents are diffed into the note's
 * `Y.Text` on every keystroke.
 *
 * The rules it follows are the board's rules for an editing field, and they live in
 * `useSharedTextEdit` — the limit, the caret, the IME guard, the remote update, the undo
 * takeover, the step boundaries and the press-outside that closes it. They live there
 * because free text edits by the same rules in a different element, and two copies of
 * those rules is two chances for a note and a piece of text to disagree about when a
 * keystroke reaches the document.
 *
 * What is a note's own:
 *
 * - The element: a `textarea`, which is a box of its own making and suits a note whose
 *   size is its size. Free text uses a `contenteditable` div instead, because its box
 *   grows with what is written in it.
 * - **The font auto-fits**: the note shrinks its text until it fits the paper, and fades
 *   the bottom when even that is not enough (`sticky.text_limit`).
 * - The counter, which appears as the limit approaches.
 */
import { useState } from 'react';
import type * as Y from 'yjs';

import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { counterVisible, fitFontSize } from './StickyText';
import { textareaField, useSharedTextEdit } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note is rendered at, in world units. */
  fontPx: number;
  /**
   * Leave editing. The selection is left alone: Escape keeps the note selected
   * (`sticky.text`), and clicking away is the board's own click, which clears it
   * (`sel.clear`).
   */
  onEnd(): void;
  /** This person's history: step boundaries around the edit, and Ctrl+Z inside it. */
  undo?: UndoController;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps) {
  const [size, setSize] = useState(fontPx);
  const [overflow, setOverflow] = useState(false);

  const { fieldProps, value } = useSharedTextEdit<HTMLTextAreaElement>({
    ytext,
    maxChars: STICKY_TEXT_MAX_CHARS,
    field: textareaField,
    // The note element itself, so that a press on its own editor keeps editing and a
    // press anywhere else — on the board, on another note, on the bar above it — ends it.
    hostSelector: '[data-sticky-note]',
    onEnd,
    undo,
    // More or fewer words, more or fewer characters to fit: the paper has not changed,
    // so the type has to.
    onText: (_next, element) => {
      const fitted = fitFontSize(element, element.clientHeight);
      setSize(fitted.fontPx);
      setOverflow(fitted.overflow);
    },
  });

  const length = value.length;

  return (
    <div className="sticky-note__editor" data-testid="sticky-note-editor">
      <textarea
        className="sticky-note__textarea"
        data-testid="sticky-note-textarea"
        aria-label="Sticky note text"
        defaultValue=""
        spellCheck={false}
        style={{ fontSize: `${size}px` }}
        {...fieldProps}
      />
      {overflow ? (
        <div className="sticky-note__fade" data-testid="sticky-note-fade" aria-hidden="true" />
      ) : null}
      {counterVisible(length) ? (
        <div className="sticky-note__counter" data-testid="sticky-note-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
    </div>
  );
}
