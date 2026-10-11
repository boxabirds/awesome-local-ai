import type { JSX } from 'react';
import type * as Y from 'yjs';

import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  /** The note's text; every input event is diffed into it. */
  ytext: Y.Text;
  /** Fitted font size (board units, so it scales with the zoom). */
  fontPx: number;
  /** Escape -> 'selected'; pointerdown outside the note -> 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This person's undo history (story 8). The edit is one step: a boundary is
   * called when it opens and when it closes, so nothing typed is merged with the
   * drag before it or the click after it, and Ctrl/Cmd+Z typed into the note is
   * answered against the board's history rather than the textarea's own, which
   * knows nothing about the board.
   */
  readonly undo?: UndoController | undefined;
}

/**
 * The textarea shown while a note is being edited (sticky.edit_start /
 * sticky.edit_end / sticky.text_limit).
 *
 * Story 9 found this editor's behaviour — diff into the `Y.Text` on every input,
 * clamp, caret at the end, Escape and outside-click ending the edit, the board's
 * undo history answering Ctrl/Cmd+Z — was exactly what a text object needs too, so
 * the behaviour lives in `TextEditor` once and this is what a note asks of it: its
 * own 1,000-character limit, its own counter, a field sized by the note's CSS, and
 * no re-measuring of its own, because a note fits its text to its box instead of
 * growing the box.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  undo,
}: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      onEnd={onEnd}
      undo={undo}
      // Story 2's own rule about when a note's characters are worth counting.
      counter={counterVisible}
      className="sticky-textarea"
      testId="sticky-textarea"
    />
  );
}
