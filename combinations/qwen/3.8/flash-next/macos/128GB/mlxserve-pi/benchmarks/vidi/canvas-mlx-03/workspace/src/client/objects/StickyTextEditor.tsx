// Story 2's sticky-note editor, now a thin wrapper over the generalised TextEditor
// (story 9): it only supplies the sticky-specific cosmetics — the centre-aligned
// font sizing, the character counter and the stable `sticky-text-editor` test id —
// while the editing behaviour (caret at end, newline on Enter, minimal Y.Text diff,
// length clamp, Escape/outside ends the edit, Ctrl/Cmd+Z routed to the board's undo)
// is shared with free-text objects.

import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.ts';
import { counterVisible } from './StickyText.ts';
import { TextEditor } from './TextEditor.tsx';
import { useUndoController } from '../board/useUndo.ts';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps) {
  const undo = useUndoController();
  const counter = (len: number) =>
    counterVisible(len) ? (
      <span
        data-testid="sticky-counter"
        className="sticky-note__counter"
        style={{
          position: 'absolute',
          right: 6,
          bottom: 4,
          fontSize: 11,
          color: 'rgba(44,47,54,0.7)',
          pointerEvents: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {len}/{STICKY_TEXT_MAX_CHARS}
      </span>
    ) : null;

  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      textAlign="center"
      onInput={() => {}}
      onEnd={props.onEnd}
      // A sticky note is always edited inside a board that mounted a controller; a
      // bare component test renders none, in which case Ctrl/Cmd+Z is a no-op.
      undo={undo!}
      counter={counter}
      testId="sticky-text-editor"
    />
  );
}
