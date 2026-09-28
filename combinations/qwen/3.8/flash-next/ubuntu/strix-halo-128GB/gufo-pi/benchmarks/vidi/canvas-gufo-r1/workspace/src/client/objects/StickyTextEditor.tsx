import { useState } from 'react';
import type * as Y from 'yjs';
import { counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

/**
 * Textarea-based editor for a sticky note. Thin wrapper around TextEditor
 * that adds the character counter specific to sticky notes.
 */
export function StickyTextEditor(props: StickyTextEditorProps) {
  const { ytext, fontPx, onEnd, undoController } = props;
  const [showCounter, setShowCounter] = useState(
    counterVisible(ytext.toString().length),
  );
  const [charCount, setCharCount] = useState(ytext.toString().length);

  const handleInput = () => {
    const len = ytext.toString().length;
    setCharCount(len);
    setShowCounter(counterVisible(len));
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fontPx}
        width="auto"
        onInput={handleInput}
        onEnd={onEnd}
        undoController={undoController}
        testId="sticky-textarea"
      />
      {showCounter && (
        <span
          className="sticky-counter"
          data-testid="sticky-counter"
          aria-live="polite"
        >
          {charCount}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
