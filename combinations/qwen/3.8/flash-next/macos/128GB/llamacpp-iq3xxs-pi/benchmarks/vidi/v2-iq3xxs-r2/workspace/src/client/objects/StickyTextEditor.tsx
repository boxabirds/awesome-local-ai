import type { JSX } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { useUndoController } from '../board/useUndo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  /** The note's shared text; every `input` event is written to it immediately. */
  ytext: Y.Text;
  /** Auto-fitted font size in board units, measured by the note. */
  fontPx: number;
  /** Escape ends editing and keeps the note selected; a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea that edits a sticky note: the general `TextEditor`, with a note's limits,
 * its styling and its character counter.
 *
 * Story 9 found the editor was only ever *a note's* editor, and that everything in it — the
 * minimal diff, the caret handling of remote changes, the IME flush, the undo boundaries,
 * Ctrl/Cmd+Z going to the shared text rather than to the textarea — is about editing a
 * `Y.Text` on a board, not about a note. So this file is now the note's half of it: the
 * 1,000 characters, the auto-fitted font, the counter that only notes have ever shown, and
 * the width the note's own box gives it (`auto`, because the CSS box is the note).
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const undo = useUndoController();
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      onEnd={onEnd}
      undo={undo}
      className="vidi6-sticky-editor"
      testId="sticky-editor"
      ariaLabel="Sticky note text"
      renderCounter={(length) =>
        counterVisible(length) ? (
          <span className="vidi6-sticky-counter" data-testid="sticky-counter" aria-live="polite">
            {`${length}/${STICKY_TEXT_MAX_CHARS}`}
          </span>
        ) : null
      }
    />
  );
}
