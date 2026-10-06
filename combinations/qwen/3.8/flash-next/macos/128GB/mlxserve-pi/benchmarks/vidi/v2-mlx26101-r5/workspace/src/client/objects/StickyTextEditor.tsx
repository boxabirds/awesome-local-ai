/**
 * The sticky note's editor: the shared text editor, set up the way a note wants it.
 *
 * Story 2 wrote this file, and wrote the IME composition, the undo chord, the click outside, the
 * two-way editing and the limit into it, because that is what typing into a shared board takes. Story 9
 * needed the identical thing for a text object — down to the caret position on focus and the counter
 * appearing at the same distance from the limit — and a second copy of that would be a second place to
 * be wrong. So the behaviour lives in `TextEditor.tsx` now, and what is left here is a note's
 * configuration of it: the note's limit and counter, the note's class and test ids, and the one rule
 * that really is about notes — a note left empty stays on the board, which is why closing the editor
 * says nothing about what the selection should become.
 *
 * The helpers this file used to own are where they are needed now: the text-editing ones in
 * `StickyText.ts` (shared with text objects, which edit text the same way), and `isTypingTarget`, which
 * the board asks about the keyboard, is exported from `TextEditor.tsx` and re-exported here unchanged.
 */

import type * as Y from 'yjs';

import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';
import type { UndoControls } from '../board/useUndo';

export { isTypingTarget } from './TextEditor';

export interface StickyTextEditorProps {
  /** The sticky note's shared text — every input event is written straight into it. */
  ytext: Y.Text;
  /** Font size in world units — the size the note is drawn at. */
  fontPx: number;
  /**
   * Called exactly once when editing ends (Escape, blur, a pointerdown outside). The text is already
   * committed by then: an end performs no write, so nothing typed is lost — including a paste that went
   * over the limit and was truncated.
   */
  onEnd(): void;
  /**
   * This person's undo history, for the undo/redo chords pressed with the caret inside the text.
   *
   * A textarea is the one place on the board where Ctrl+Z cannot be answered from outside: the browser
   * undoes what is on screen and does not tell the document it did. So the chord is taken here, from
   * the keystroke, before the browser sees it, and answered from the board's own history.
   */
  undo?: UndoControls;
}

/**
 * The textarea shown while a sticky note is being edited.
 *
 * It is uncontrolled: on mount it takes the note's text, focuses itself and puts the caret at the end
 * (the "start editing" contract). Every input event is clamped to {@link STICKY_TEXT_MAX_CHARS} and
 * written into the `Y.Text` as a minimal diff, so ending editing performs no further write and all text
 * typed so far is kept. IME composition is skipped and handled on `compositionend`, so input methods
 * never duplicate characters. The counter appears once the text is within
 * {@link STICKY_COUNTER_THRESHOLD_CHARS} characters of the limit, so a paste that goes over the limit
 * truncates in front of the person with the number showing why.
 *
 * Two people can edit one note at once, so the box is kept up to date with the shared text as changes
 * arrive: what the box holds is always the shared text plus what has been typed here, which is what
 * makes the minimal diff describe one person's keystroke and nothing else.
 */
export function StickyTextEditor(props: StickyTextEditorProps): React.JSX.Element {
  const { ytext, fontPx, onEnd, undo } = props;
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      label="Sticky note text"
      className="sticky-editor"
      testId="sticky"
      counterFrom={STICKY_COUNTER_THRESHOLD_CHARS}
      undo={undo}
      onEnd={() => {
        // A note that was left with nothing in it is still a note: what is selected after editing ends
        // is the board's business, and it already knows — this press is the one it is reading.
        onEnd();
      }}
    />
  );
}
