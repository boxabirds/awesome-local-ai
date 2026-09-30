import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { useUndoController } from '../board/useUndo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

const noop = () => {};

/**
 * Story 2's note editor: the shared TextEditor with the note's limit, label
 * and remaining-characters counter. Other people's typing is merged while
 * editing (story 3); Ctrl/Cmd+Z acts on this note's typing only (story 8).
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Top padding (board units) that vertically centres short text like the display mode. */
  padTop?: number;
}) {
  const undo = useUndoController();
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      onInput={noop}
      onEnd={props.onEnd}
      undo={undo}
      label="Note text"
      className="sticky-editor"
      padTop={props.padTop}
      footer={(length) =>
        counterVisible(length) && (
          <div className="sticky-counter" aria-live="polite">
            {`${length}/${STICKY_TEXT_MAX_CHARS}`}
          </div>
        )
      }
    />
  );
}
