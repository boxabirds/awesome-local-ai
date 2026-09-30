import { useMemo } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';
import type { UndoController } from '@client/board/undo';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  onBoundary?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

/**
 * Story 2 sticky editor, now a thin wrapper around the shared TextEditor
 * (story 9). It keeps the sticky-specific chrome: centered text, 16px
 * padding, the character counter, and the 'editor' Yjs origin.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, onBoundary, onUndo, onRedo }: StickyTextEditorProps): JSX.Element {
  // Adapt the story 2 callbacks to the UndoController interface.
  const undo: UndoController = useMemo(() => ({
    boundary: () => { onBoundary?.(); },
    undo: () => { onUndo?.(); return true; },
    redo: () => { onRedo?.(); return true; },
    canUndo: () => false,
    canRedo: () => false,
    addScope: () => { /* not used by the editor */ },
    onChange: () => () => { /* not used by the editor */ },
    destroy: () => { /* not owned by the editor */ },
  }), [onBoundary, onUndo, onRedo]);

  const text = ytext.toString();
  const showCounter = counterVisible(text.length);

  return (
    <>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fontPx}
        width="auto"
        onInput={() => { /* stickies have a fixed box; nothing to re-measure */ }}
        onEnd={onEnd}
        undo={undo}
        ariaLabel="Sticky note text"
        testId="sticky-text-editor"
        textAlign="center"
        padding={16}
        origin="editor"
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: '9px',
            color: 'rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </>
  );
}
