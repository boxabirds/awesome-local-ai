// Text editor for sticky notes: a thin wrapper around the shared TextEditor
// (story 9) with the sticky-note parameters.

import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** End editing. The selection is kept (story 7: Escape → back to selected). */
  onEnd: () => void;
  /** Undo boundary callback (story 8): called on mount and on end. */
  onBoundary?: () => void;
  /** Undo the last typing step (story 8). */
  onUndo?: () => void;
  /** Redo the last undone typing step (story 8). */
  onRedo?: () => void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, onBoundary, onUndo, onRedo }: StickyTextEditorProps) {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      padding={16}
      ariaLabel="Sticky note text"
      textareaClassName="sticky-text-editor__textarea"
      onEnd={onEnd}
      onBoundary={onBoundary}
      onUndo={onUndo}
      onRedo={onRedo}
    />
  );
}
