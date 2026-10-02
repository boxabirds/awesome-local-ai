import React from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible, NOTE_TEXT_INSET } from './StickyText';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size fitted for the note's current text, in board units. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController;
}

/**
 * The textarea shown while a sticky note is being edited (story 2). Story 9
 * generalised the editor itself into `TextEditor`; this is the sticky-note
 * flavour: note insets, centred text, font auto-fit and the character counter.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, undoController }: StickyTextEditorProps) {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      onInput={() => {}}
      onEnd={onEnd}
      undo={undoController}
      autoFit
      testId="sticky-note-editor"
      containerSelector="[data-note-id]"
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
        maxWidth: 'none',
        minWidth: 0,
        fontFamily: 'inherit',
        fontWeight: 500,
        lineHeight: 1.25,
        textAlign: 'center',
      }}
    />
  );
}
