// StickyTextEditor (story 2): the textarea used while a note is being edited.
//
// Story 9 (text.editing): the general editor engine moved to TextEditor;
// this is now a thin wrapper that keeps the story 2 behaviour — binary-search
// font fitting against the note's text box, the character counter, and the
// onBoundary/onUndoShortcut callback props — on top of the shared component.

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import {
  counterVisible,
  fitFontSize,
  NOTE_TEXT_BOX,
} from './StickyText';
import { TextEditor, type TextEditorUndo } from './TextEditor';

export interface TextFit {
  fontPx: number;
  overflow: boolean;
}

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** The font size found in display mode; the editor re-measures on mount. */
  fontPx: number;
  /**
   * Height (world units) of the region the text must fit into. Defaults to
   * the standard sticky size (story 7: resized notes pass their own).
   */
  textBox?: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Reports the editor's measured fit (font size + overflow flag). */
  onFitChange?(fit: TextFit): void;
  /**
   * Story 8 (undo.boundaries): called when editing starts and ends, so a
   * typing session is one undo step separate from surrounding actions.
   */
  onBoundary?(): void;
  /**
   * Story 8 (undo.shortcuts): called for Ctrl/Cmd+Z (redo=false) and
   * Ctrl/Cmd+Shift+Z / Ctrl+Y (redo=true) inside the textarea. The editor
   * preventDefaults them so the browser's native textarea undo never
   * diverges from Y.Text.
   */
  onUndoShortcut?(redo: boolean): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, onFitChange, onBoundary, onUndoShortcut } = props;
  const box = props.textBox ?? NOTE_TEXT_BOX;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const [fit, setFit] = useState<TextFit>(() => ({ fontPx, overflow: false }));

  const onFitChangeRef = useRef(onFitChange);
  onFitChangeRef.current = onFitChange;
  const onBoundaryRef = useRef(onBoundary);
  onBoundaryRef.current = onBoundary;
  const onUndoShortcutRef = useRef(onUndoShortcut);
  onUndoShortcutRef.current = onUndoShortcut;

  // Adapt the story 2 callback props to the UndoController interface the
  // shared editor speaks. Only when both are provided, so a partial harness
  // keeps the textarea's native undo.
  const undoAdapter: TextEditorUndo | undefined = useMemo(() => {
    if (onBoundary === undefined && onUndoShortcut === undefined) return undefined;
    return {
      boundary: () => onBoundaryRef.current?.(),
      undo: () => {
        onUndoShortcutRef.current?.(false);
        return true;
      },
      redo: () => {
        onUndoShortcutRef.current?.(true);
        return true;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus, caret-at-end and the undo boundaries are handled by the shared
  // editor (TextEditor) on mount/unmount, through the adapter above.

  // Font fit: binary search on the real layout, on mount, on text change and
  // when the fit box changes (resized notes, story 7).
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const next = fitFontSize(ta, box);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
    onFitChangeRef.current?.(next);
  }, [value, box]);

  return (
    <div className="sticky-note__editor">
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fit.fontPx}
        width="auto"
        height="auto"
        className="sticky-note__textarea"
        ariaLabel="Sticky note text"
        testId="sticky-editor"
        spellCheck={false}
        textareaRef={taRef}
        onValueChange={setValue}
        onInput={() => undefined}
        onEnd={onEnd}
        undo={undoAdapter}
      />
      {counterVisible(value.length) && (
        <div
          className="sticky-note__counter"
          data-testid="sticky-counter"
          aria-live="polite"
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
