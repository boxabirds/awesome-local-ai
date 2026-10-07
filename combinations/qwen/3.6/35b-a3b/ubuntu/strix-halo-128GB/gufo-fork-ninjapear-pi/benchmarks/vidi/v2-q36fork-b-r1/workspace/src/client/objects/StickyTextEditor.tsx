import type { ReactNode } from 'react';
import * as Y from 'yjs';
import { TextEditor } from './TextEditor';
import { STICKY_TEXT_MAX_CHARS, STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX } from '@/shared/config';
import type { UndoController } from '@/client/board/undo';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  overflow?: boolean;
  /** Optional undo controller for per-user undo history. */
  undoController?: UndoController | null;
}

/**
 * Thin wrapper around TextEditor for sticky notes.
 * Retains the original styling and overflow-fade class for backwards compatibility.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  overflow = false,
  undoController,
}: StickyTextEditorProps): ReactNode {
  return (
    <div className={overflow ? 'sticky-text-overflow-fade' : ''}>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fontPx}
        width="auto"
        onInput={() => {}}
        onEnd={onEnd}
        undoController={undoController}
      />
    </div>
  );
}
