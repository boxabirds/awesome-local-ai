import * as React from 'react';
import type { useUndo } from './useUndo';

export function UndoButtons(
  props: ReturnType<typeof useUndo>,
): React.JSX.Element {
  const { canUndo, canRedo, undo, redo } = props;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <button
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: '#fff',
          cursor: canUndo ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        ↩️
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: '#fff',
          cursor: canRedo ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        ↪️
      </button>
    </div>
  );
}
