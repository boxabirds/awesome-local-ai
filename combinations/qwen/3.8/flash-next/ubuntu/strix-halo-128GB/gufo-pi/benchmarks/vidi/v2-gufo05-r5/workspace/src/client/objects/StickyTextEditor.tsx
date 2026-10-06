/**
 * The text editor inside a sticky note.
 *
 * Story 9 lifted the editor itself into `TextEditor.tsx`, because a text object needs the same
 * behaviour - caret at the end, minimal `Y.Text` diff, IME handling, this person's undo inside
 * the field. What is left here is the note's own settings: its character limit, the font that
 * shrinks to fit the note, the remaining-characters counter and the classes the note's stylesheet
 * styles.
 */
import type { JSX } from 'react';
import type * as Y from 'yjs';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { STICKY_TEXT_BOX_WORLD } from './StickyText';

export interface StickyTextEditorProps {
  /** The note's shared text. When the note is deleted the text is detached and writes stop. */
  ytext: Y.Text;
  /** Font size to start with, in world units (re-fitted as the text changes). */
  fontPx: number;
  /** Called when editing ends: back to selected (Escape) or deselected (click outside). */
  onEnd(next: EndEditNext): void;
  /** Story 8: this person's history, for Ctrl/Cmd+Z inside the field. */
  undo?: UndoController | null;
}

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
      onEnd={onEnd}
      undo={undo}
      fitTo={STICKY_TEXT_BOX_WORLD}
      counter={{ threshold: STICKY_COUNTER_THRESHOLD_CHARS }}
      className="sticky-note__input"
      testId="sticky-note-input"
      ariaLabel="Sticky note text"
      counterClassName="sticky-note__counter"
      counterTestId="note-counter"
    />
  );
}
