/**
 * The sticky note's inline text editor (story 2): a thin wrapper around the
 * generalised TextEditor (story 9) with the sticky presentation — the font
 * auto-fit into the note's text box, the note padding, the overflow fade and
 * the 1,000-character counter. Story 2 callers and tests are unchanged.
 */
import type { JSX } from 'react';
import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_TEXT_PADDING,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { TextEditor, TEXT_INK, type TextEditorUndo } from './TextEditor';

/**
 * The full inner box the text may occupy, in board units
 * (note size minus padding on both sides).
 */
const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING * 2;

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Maximum font size; the editor fits the text into the note below it. */
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  /**
   * Close the undo capture window (story 8): called when editing starts and
   * ends, so the typing burst is its own undo step and never merges with
   * the action before or after the edit.
   */
  onBoundary?(): void;
  /** Ctrl/Cmd+Z inside the editor: undo this tab's last step (story 8). */
  onUndo?(): void;
}

const NOOP: TextEditorUndo = {
  boundary(): void {},
  undo(): void {},
};

export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  onBoundary,
  onUndo,
}: StickyTextEditorProps): JSX.Element {
  const undo: TextEditorUndo =
    onBoundary !== undefined || onUndo !== undefined
      ? { boundary: onBoundary ?? (() => {}), undo: onUndo ?? (() => {}) }
      : NOOP;

  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width={TEXT_BOX}
      onInput={() => {}}
      onEnd={onEnd}
      undo={undo}
      fit={(ta) => fitFontSize(ta, TEXT_BOX)}
      ui={{
        ariaLabel: 'Sticky note text',
        textareaTestid: 'sticky-textarea',
        editorTestid: 'sticky-text-editor',
        counterTestid: 'sticky-counter',
        fadeTestid: 'sticky-fade',
        padding: STICKY_TEXT_PADDING,
        lineHeight: 1.2,
        color: TEXT_INK,
        counterNear: STICKY_COUNTER_THRESHOLD_CHARS,
      }}
    />
  );
}
