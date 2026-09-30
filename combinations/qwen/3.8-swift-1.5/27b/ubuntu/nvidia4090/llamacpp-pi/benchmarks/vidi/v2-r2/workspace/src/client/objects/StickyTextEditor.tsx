import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Called on edit start and end to close the undo capture window. */
  boundary?: () => void;
  /** Undo controller for handling Ctrl/Cmd+Z inside the editor. */
  undoController?: { undo(): boolean };
}

/**
 * Text editing inside a sticky note (story 2). A thin wrapper around the
 * generalized {@link TextEditor} (story 9) with the sticky-note styling:
 * centred text, 16px padding, and the character counter near the limit.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, boundary, undoController }: StickyTextEditorProps) {
  return (
    <TextEditor
      ytext={ytext}
      fontPx={fontPx}
      maxChars={STICKY_TEXT_MAX_CHARS}
      padding={16}
      lineHeight={1.2}
      textAlign="center"
      testId="sticky-editor"
      ariaLabel="Sticky note text"
      showCounter
      onInput={() => {
        // Sticky notes do not remeasure a box (fixed square size).
      }}
      onEnd={onEnd}
      boundary={boundary}
      undoController={undoController}
    />
  );
}
