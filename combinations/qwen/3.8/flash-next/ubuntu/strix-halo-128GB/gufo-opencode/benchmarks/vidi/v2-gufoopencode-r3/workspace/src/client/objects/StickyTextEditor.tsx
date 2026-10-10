import type { JSX } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { counterVisible, type EndEditNext } from './StickyText';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndEditNext): void;
  // This tab's undo history. Absent means Ctrl+Z keeps the browser default.
  undo?: UndoController;
}

// Story 2 editor, now a thin wrapper over the shared generalised TextEditor.
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  undo
}: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      onEnd={onEnd}
      undo={undo}
      testId="sticky-textarea"
      className="sticky-textarea"
      renderCounter={(length) =>
        counterVisible(length) ? (
          <div className="sticky-counter" data-testid="sticky-counter">
            {length}/{STICKY_TEXT_MAX_CHARS}
          </div>
        ) : null
      }
    />
  );
}
