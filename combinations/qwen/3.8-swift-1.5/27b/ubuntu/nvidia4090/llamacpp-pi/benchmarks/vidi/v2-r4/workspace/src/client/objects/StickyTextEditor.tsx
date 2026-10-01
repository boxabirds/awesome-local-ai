import type { JSX } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Per-user undo controller (story 8). */
  undo?: Pick<UndoController, 'boundary' | 'undo' | 'redo'>;
}

/**
 * Story 2 sticky-note editor, now a thin wrapper over the generalised
 * TextEditor (story 9). Sticky notes keep their story 2 behaviour: 1,000
 * char limit with counter, 12px padding, and empty text is kept (an empty
 * sticky note is a valid note).
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, undo } = props;
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      onInput={() => {
        // Sticky notes are fixed size: no box remeasure needed.
      }}
      onEnd={(next) => {
        // Story 2 behaviour: closing the editor closes the capture window so
        // the typing burst never merges with the next gesture (undo.boundary).
        onEnd(next);
        undo?.boundary();
      }}
      undo={undo}
      counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
      padding={12}
      paddingVertical={12}
      dataTestId="sticky-text-editor"
    />
  );
}
