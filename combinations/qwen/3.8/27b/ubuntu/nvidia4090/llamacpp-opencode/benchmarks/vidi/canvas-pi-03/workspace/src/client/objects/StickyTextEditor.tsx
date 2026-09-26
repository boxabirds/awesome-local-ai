import { useMemo, useRef, type ReactElement } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '@/shared/config';
import { NOTE_PADDING, NOTE_TEXT_BOX } from './StickyText';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Current fitted font size in world px (shared with the display mode). */
  fontPx: number;
  /** Ends editing: 'selected' (Escape) or 'unselected' (click outside). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8: close the capture window (edit start and edit end). */
  onBoundary?: () => void;
  /** Story 8: undo this tab's own step (Ctrl/Cmd+Z inside the editor). */
  onUndo?: () => void;
  /** Story 8: redo this tab's own step (Ctrl/Cmd+Shift+Z inside the editor). */
  onRedo?: () => void;
}

/**
 * Text editing mode for a sticky note (story 2). Story 9 generalised the
 * editor to {@link TextEditor} (free text objects share it); this is a thin
 * wrapper that keeps the sticky-note layout (fixed inset box, centred text,
 * 1.25 line height, 1,000-character counter) and adapts the board's undo
 * callbacks to the editor's per-user undo controller.
 */
export function StickyTextEditor(props: StickyTextEditorProps): ReactElement {
  const { ytext, fontPx, onEnd, onBoundary, onUndo, onRedo } = props;
  const boundaryRef = useRef(onBoundary);
  boundaryRef.current = onBoundary;
  const undoRef = useRef(onUndo);
  undoRef.current = onUndo;
  const redoRef = useRef(onRedo);
  redoRef.current = onRedo;

  const undo = useMemo<UndoController>(
    () => ({
      undo: () => {
        undoRef.current?.();
        return true;
      },
      redo: () => {
        redoRef.current?.();
        return true;
      },
      boundary: () => {
        boundaryRef.current?.();
      },
      canUndo: () => true,
      canRedo: () => true,
      addScope: () => {},
      onChange: () => () => {},
      destroy: () => {},
    }),
    [],
  );

  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width={NOTE_TEXT_BOX}
      height="fill"
      inset={NOTE_PADDING}
      onEnd={onEnd}
      undo={undo}
      align="center"
      lineHeight={1.25}
      spellCheck={false}
      counter
      testId="sticky-text-editor"
      textareaTestId="sticky-textarea"
    />
  );
}
