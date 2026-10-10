import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_PADDING_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { useBoardUndo } from '../board/useUndo';
import { TextEditor } from './TextEditor';

/**
 * The textarea that edits one sticky note's `sticky.text` (anchor `sticky.text`).
 *
 * Story 9 moved the editing itself to `TextEditor`, which is the same code with
 * the note's numbers filled in: story 2's limit, its padding, its counter threshold
 * and its class names are unchanged, so a note is edited exactly as it always was
 * and a text object is edited the same way.
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Painted over the note's own text so only one copy is visible. */
  background?: string;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps) {
  const { ytext, fontPx, background, onEnd } = props;
  const undo = useBoardUndo();

  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      onInput={() => {
        // A sticky note's box never follows its text: the note has a size of its
        // own, so a sticky change has nothing to measure (`text.height` is about
        // text objects only).
      }}
      onEnd={onEnd}
      undo={undo}
      counterLimit={STICKY_TEXT_MAX_CHARS}
      counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
      background={background}
      paddingPx={STICKY_PADDING_WORLD}
      className="sticky-note__editor"
      wrapClassName="sticky-note__editor-wrap"
      testId="sticky-editor"
      wrapTestId="sticky-editor-wrap"
      counterTestId="sticky-counter"
      ariaLabel="Sticky note text"
    />
  );
}
