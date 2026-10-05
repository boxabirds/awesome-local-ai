/**
 * The textarea a sticky note is typed into.
 *
 * Story 2 wrote the whole of this component, and story 9 found it was not a sticky note's component but a
 * *text editor* that had so far only ever been used by one: the caret at the end of the text, the keystroke
 * written into the `Y.Text` as it happens, the limit applied as it is typed, Enter adding a line, Escape
 * ending the edit with the text kept, the input-method composition that must not be doubled, somebody
 * else's characters arriving without moving this person's cursor — none of that is about notes. It is now
 * `TextEditor.tsx`, which both object types drive, and what is left here is the note's half of the
 * arrangement:
 *
 *   - the note's limit (`STICKY_TEXT_MAX_CHARS`) and the distance from it at which the counter speaks;
 *   - the box the text has to fit into, which is what makes a sticky note the one object on the board that
 * *shrinks its own font*: the note is a fixed square, so text that outgrew it had to be made smaller,
 *     whereas free text grows a bigger box instead and keeps its size;
 *   - the class names and test ids story 2's tests and styles were written against.
 *
 * `STICKY_TEXT_BOX` and `Fit` are still exported from here, because they are the note's own facts.
 */
import type { JSX } from 'react';

import type * as Y from 'yjs';

import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_PADDING_WORLD, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoActions } from '../board/undo';
import { TextEditor } from './TextEditor';
import { STICKY_FONT_BOUNDS } from './StickyText';
import type { Fit } from './StickyText';

/** Height available to the text inside a note, in board units. */
export const STICKY_TEXT_BOX = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export interface StickyTextEditorProps {
  /** The note's text; every keystroke is diffed into it. */
  ytext: Y.Text;
  /** Font size to start at, measured while the note was not being edited. */
  fontPx: number;
  /**
   * Editing finished: Escape from the text, or a press outside the note. Either way the note is left
   * selected — the press that means otherwise is a selection action of its own, and says so.
   */
  onEnd(): void;
  /** Reported after each measurement so the note can show its overflow fade. */
  onFit?(fit: Fit): void;
  /**
   * This person's undo history, in the form a note may reach for.
   *
   * Two things are done with it, and both are about the fact that a note being typed in is a different
   * thing to undo from a note being moved: the edges of the edit are named, so that a burst of typing is
   * one step and never swallows the move that happened just before it; and Ctrl/Cmd+Z pressed inside this
   * text is answered here rather than left to the browser, whose own textarea history would undo the
   * characters on the screen while the document still held them — after which the note and the undo button
   * are disagreeing about what the board looks like.
   */
  undo?: UndoActions;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, onFit, undo }: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
      fontPx={fontPx}
      // The one caller that shrinks its font: a note is a square, and the words have to live inside it.
      fitBox={STICKY_TEXT_BOX}
      fitBounds={STICKY_FONT_BOUNDS}
      onEnd={onEnd}
      onFit={onFit}
      undo={undo}
      textareaTestId="sticky-textarea"
      counterTestId="sticky-counter"
      ariaLabel="Sticky note text"
      wrapperClassName="sticky-note__editor"
      textareaClassName="sticky-note__textarea"
      counterClassName="sticky-note__counter"
    />
  );
}
