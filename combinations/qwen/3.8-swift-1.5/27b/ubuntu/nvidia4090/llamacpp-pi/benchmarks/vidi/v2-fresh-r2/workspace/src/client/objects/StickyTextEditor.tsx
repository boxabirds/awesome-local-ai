/**
 * Text editor for sticky notes (story 2) — now a thin wrapper around the
 * generalised TextEditor (story 9, text.editing). Keeps the sticky-specific
 * font fit, character counter, padding and test ids so the story 2 behaviour
 * (and tests) are unchanged.
 */

import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { counterVisible, fitFontSize } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { TextEditor } from './TextEditor';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Text box width in world units (note width minus padding). */
  boxWidth?: number;
  /** Text box height in world units (note height minus padding). */
  boxHeight?: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Undo controller for boundary() and Ctrl+Z handling (story 8). */
  undo?: UndoController;
}

/** Padding inside the note for text (world units). */
const PADDING = 16;

export function StickyTextEditor({ ytext, fontPx: initialFontPx, boxWidth, boxHeight, onEnd, undo }: StickyTextEditorProps): JSX.Element {
  // Story 7: the note may be resized; the text box follows its size.
  const textBoxHeight = boxHeight ?? 168;
  const [fontPx, setFontPx] = useState(initialFontPx);

  const fit = useCallback((el: HTMLTextAreaElement) => {
    const r = fitFontSize(el, textBoxHeight);
    setFontPx(r.fontPx);
  }, [textBoxHeight]);

  const footer = useCallback((length: number) => {
    if (!counterVisible(length)) return null;
    return (
      <div
        data-testid="char-counter"
        style={{
          position: 'absolute',
          bottom: 4,
          right: 8,
          fontSize: 10,
          color: '#666',
          pointerEvents: 'none',
        }}
      >
        {STICKY_TEXT_MAX_CHARS}/{STICKY_TEXT_MAX_CHARS}
      </div>
    );
  }, []);

  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width={boxWidth ?? 'auto'}
      padding={PADDING}
      ariaLabel="Sticky note text"
      testId="sticky-textarea"
      onEnd={onEnd}
      undo={undo}
      fit={fit}
      footer={footer}
    />
  );
}
