import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible } from './StickyText';
import { NOTE_SELECTOR, TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export { NOTE_SELECTOR };

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size from the note's auto-fit, so editing and display look identical. */
  fontPx: number;
  /** Escape keeps the selection, a click outside drops it. */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This tab's undo history (story 8): editing is one step, and Ctrl/Cmd+Z typed
   * inside the textarea steps that history rather than the textarea's own.
   */
  undo?: UndoController;
}

/**
 * Text editing for one sticky note — story 2's editor, now the shared `TextEditor`
 * with the sticky note's settings filled in: the 1,000 character limit, the note's
 * own fixed square as the editing width (the text cannot reflow a note), and the
 * "n/1000" counter that appears near the limit (PRD sticky.counter).
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps) {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="fill"
      onEnd={onEnd}
      undo={undo}
      rootSelector={NOTE_SELECTOR}
      inputClassName="sticky-note-input"
      inputTestId="sticky-note-input"
      inputAriaLabel="Sticky note text"
      renderStatus={(length) =>
        counterVisible(length) ? (
          <div className="sticky-note-counter" data-testid="sticky-note-counter" aria-live="polite">
            {`${length}/${STICKY_TEXT_MAX_CHARS}`}
          </div>
        ) : null
      }
    />
  );
}
