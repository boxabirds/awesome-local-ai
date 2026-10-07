import * as React from 'react';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';

interface StickyTextEditorProps {
  value: string;
  fontPx: number;
  overflow: boolean;
  onChange(next: string): void;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): React.JSX.Element {
  const { value, fontPx, overflow, onChange, onEnd } = props;

  const ref = React.useRef<HTMLTextAreaElement>(null);
  const composingRef = React.useRef(false);
  const [charCount, setCharCount] = React.useState(value.length);

  React.useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, []);

  // Handle input events (with IME awareness)
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) return;
      const next = e.target.value.slice(0, STICKY_TEXT_MAX_CHARS);
      onChange(next);
      setCharCount(next.length);
    },
    [onChange],
  );

  const handleCompositionStart = React.useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback(() => {
    composingRef.current = false;
  }, []);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEnd('selected');
      }
      // Enter inserts newline (default textarea behavior)
      // Backspace/Delete edit characters (default textarea behavior)
    },
    [onEnd],
  );

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      rows={1}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        fontSize: `${fontPx}px`,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#333',
        textAlign: 'center',
        padding: '16px',
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        lineHeight: '1.3',
        zIndex: 10,
        cursor: 'text',
        userSelect: 'text',
        overflow: overflow ? 'hidden' : 'auto',
      }}
      aria-label="Edit sticky note text"
    />
  );
}
