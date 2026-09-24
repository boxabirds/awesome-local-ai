import { useContext, useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import { UndoContext } from '../board/useUndo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndEditNext): void;
}

const noop = () => undefined;

/**
 * Story 2's note editor: the shared TextEditor (story 9) with the sticky limit, centred over the
 * note's text, plus the character counter near the limit.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const [length, setLength] = useState(() => ytext.length);
  const undo = useContext(UndoContext);
  return (
    <>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fontPx}
        width="auto"
        onInput={noop}
        onEnd={onEnd}
        undo={undo}
        className="sticky-note__editor"
        ariaLabel="Note text"
        onLengthChange={setLength}
      />
      {counterVisible(length) && (
        <div className="sticky-note__counter" aria-live="polite" data-testid="sticky-counter">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
