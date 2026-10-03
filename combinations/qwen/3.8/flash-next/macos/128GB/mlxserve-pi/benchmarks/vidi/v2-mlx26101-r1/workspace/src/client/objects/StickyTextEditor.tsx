// The sticky note's live editor (sticky.text.editing). Story 9 generalised this
// editor into `TextEditor` so a free text object edits exactly like a note, so what
// is left here is the sticky note's own settings: its 2 000 character budget, its
// shrink-to-fit font (notes have a fixed box), the near-limit counter, its classes
// and its test ids. Every behaviour — caret at the end on mount, minimal Y.Text diff,
// IME composition, remote typing adopted around the caret, Escape keeps the note
// selected, a click outside deselects, Ctrl/Cmd+Z goes to this tab's undo controller,
// undo boundaries around the edit — lives in `TextEditor` and is unchanged.

import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type * as Y from 'yjs';
import { useUndoController } from '../board/useUndo';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note was showing when editing began (starting point). */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  // This tab's undo controller (may be absent, e.g. a board that failed to load).
  const undo = useUndoController();
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto" // the note's own class sizes the box
      autoFit
      showCounter
      testId="sticky-note-text"
      ariaLabel="Sticky note text"
      className="sticky-text sticky-editing"
      fadeTestId="sticky-overflow-fade"
      counterTestId="sticky-counter"
      undo={undo}
      onInput={() => {}} // a note's box never follows its text
      onEnd={onEnd}
    />
  );
}
