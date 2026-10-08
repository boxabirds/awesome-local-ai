import * as React from 'react';
import type { useUndo } from './useUndo';
import { UndoButtons } from './UndoButtons';

interface ToolbarProps {
  onCreateSticky(): void;
  undoProps?: ReturnType<typeof useUndo>;
  // Story 9: tool mode props
  activeTool?: 'select' | 'text';
  onToolChange?(tool: 'select' | 'text'): void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { onCreateSticky, undoProps, activeTool, onToolChange } = props;

  return (
    <div
      className="toolbar"
      style={{
        position: 'fixed',
        left: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        zIndex: 99,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onToolChange?.('select')}
        aria-label="Select (V)"
        aria-pressed={activeTool === 'select'}
        title="Select – or press V"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: activeTool === 'select' ? '#e8f0fe' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          boxShadow: activeTool === 'select' ? '0 0 0 2px #1a73e8' : '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        👆
      </button>
      <button
        onClick={() => onToolChange?.('text')}
        disabled={!onToolChange}
        aria-label="Text (T)"
        aria-pressed={activeTool === 'text'}
        title="Text – or press T"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: activeTool === 'text' ? '#e8f0fe' : '#fff',
          cursor: onToolChange ? 'pointer' : 'not-allowed',
          opacity: onToolChange ? 1 : 0.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          fontWeight: 600,
          fontFamily: 'Inter, system-ui, sans-serif',
          boxShadow: activeTool === 'text' ? '0 0 0 2px #1a73e8' : '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        T
      </button>
      <button
        onClick={() => onCreateSticky()}
        aria-label="Sticky note (N)"
        title="Sticky note – or double-click the board"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        📝
      </button>
      {undoProps && <UndoButtons {...undoProps} />}
    </div>
  );
}
