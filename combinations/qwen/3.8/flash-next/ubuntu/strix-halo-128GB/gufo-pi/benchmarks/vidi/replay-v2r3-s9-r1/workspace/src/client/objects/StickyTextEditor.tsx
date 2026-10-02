/**
 * Sticky note text editor (story 2): a thin wrapper around the shared
 * `TextEditor` with the sticky defaults — the 1,000 character limit, the inset
 * box, centred text, font auto-fit and the remaining-characters counter.
 */
import React from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { NOTE_TEXT_INSET, counterVisible, fitFontSize } from './StickyText';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size fitted for the note's current text, in board units. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, undoController }: StickyTextEditorProps) {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      onEnd={onEnd}
      undo={undoController}
      testId="sticky-note-editor"
      fit={(el) => {
        // The box is in board units, the same units the world layer is drawn in.
        const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
        fitFontSize(el, box);
      }}
      counter={(length) =>
        counterVisible(length) ? (
          <div
            data-testid="sticky-note-counter"
            style={{
              position: 'absolute',
              right: 6,
              bottom: 4,
              fontSize: 11,
              lineHeight: 1,
              color: 'rgba(0,0,0,0.45)',
              pointerEvents: 'none',
            }}
          >
            {length}/{STICKY_TEXT_MAX_CHARS}
          </div>
        ) : null
      }
      style={{
        left: NOTE_TEXT_INSET,
        top: NOTE_TEXT_INSET,
        width: `calc(100% - ${NOTE_TEXT_INSET * 2}px)`,
        height: `calc(100% - ${NOTE_TEXT_INSET * 2}px)`,
        fontWeight: 500,
        textAlign: 'center',
      }}
    />
  );
}
