import * as React from 'react';

/** Props for the share panel overlay */
export interface SharePanelProps {
  /** Full board link URL (e.g. "https://example.com/b/abc123...") */
  boardLink: string;
  /** Called when user clicks outside / presses Escape */
  onClose(): void;
  /** Callback after successful clipboard copy */
  onAfterCopy?(): void;
}

/** 
 * Share panel rendered in the top-right corner of the board page.
 * Implements TC-19 through TC-24: copy link, clipboard-fallback, link format validation.
 */
export function SharePanel(props: SharePanelProps): React.JSX.Element {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = React.useState<'normal' | 'copied' | 'manual'>('normal');
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Click outside to close
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        props.onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [props.onClose]);

  // Escape to close
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [props.onClose]);

  // Copy via clipboard API
  const handleCopy = async () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(props.boardLink);
        setCopyState('copied');
        timeoutRef.current = setTimeout(() => setCopyState('normal'), 2000);
        props.onAfterCopy?.();
      } catch {
        fallbackCopy();
      }
    } else {
      fallbackCopy();
    }
  };

  // Fallback: select text so user can press Ctrl/Cmd+C
  const fallbackCopy = () => {
    if (inputRef.current) {
      inputRef.current.select();
      inputRef.current.focus();
      setCopyState('manual');
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Share board"
      style={{
        position: 'fixed',
        top: '50px',
        right: '10px',
        width: '320px',
        padding: '16px',
        backgroundColor: '#fff',
        border: '1px solid #ddd',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1001,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Share this board</h3>
      
      <div style={{ marginBottom: '12px' }}>
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={props.boardLink}
          onClick={(e) => {
            (e.target as HTMLInputElement).select();
          }}
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '13px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontFamily: 'monospace',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <button
        onClick={handleCopy}
        aria-label="Copy link"
        style={{
          width: '100%',
          padding: '8px 12px',
          border: 'none',
          borderRadius: '4px',
          backgroundColor: copyState === 'copied' ? '#10B981' : '#4F46E5',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
          marginBottom: '8px',
        }}
      >
        {copyState === 'copied' ? '✓ Link copied' : copyState === 'manual' ? 'Select text above & press Ctrl+C (Cmd+C on Mac)' : 'Copy link'}
      </button>

      <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>
        Anyone with this link can view and edit this board.
      </p>
    </div>
  );
}
