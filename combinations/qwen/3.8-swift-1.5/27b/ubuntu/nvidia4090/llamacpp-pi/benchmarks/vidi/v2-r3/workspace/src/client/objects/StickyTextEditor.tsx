import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  /** Per-client undo history (story 8): step boundaries + in-editor shortcuts. */
  undo?: UndoController;
}

/**
 * Story 2's in-note text editor — a thin wrapper over the shared
 * `TextEditor` (story 9) with sticky-note settings: the 1000-character
 * limit, centred text, 12px padding, and the story-8 end-of-session undo
 * boundary (the shared editor leaves closing the step to the parent).
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps): React.ReactElement {
  return (
    <TextEditor
      ytext={ytext}
      fontPx={fontPx}
      maxChars={STICKY_TEXT_MAX_CHARS}
      onEnd={(next) => {
        undo?.boundary();
        onEnd(next);
      }}
      undo={undo}
      ariaLabel="Sticky note text"
      testId="sticky-text-editor"
      counterTestId="sticky-char-counter"
      textAlign="center"
      paddingPx={12}
      showCounter
    />
  );
}
