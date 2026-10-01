import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { useUndoController } from '../board/useUndo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

export const STICKY_PADDING_WORLD = 14;
export const STICKY_LINE_HEIGHT = 1.25;

export function StickyTextEditor(props: { ytext: Y.Text; fontPx: number; onEnd(next: 'selected' | 'unselected'): void }) {
  const { ytext, fontPx, onEnd } = props;
  const undo = useUndoController();
  const showCounter = counterVisible(ytext.length);

  return (
    <>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fontPx}
        width="auto"
        onInput={() => {}}
        onEnd={onEnd}
        undo={undo}
        ariaLabel="Note text"
        lineHeight={STICKY_LINE_HEIGHT}
        textAlign="center"
        clampHeight
      />
      {showCounter && (
        <span
          data-testid="char-counter"
          style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 12, color: '#555' }}
        >
          {ytext.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </>
  );
}
