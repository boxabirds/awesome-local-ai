import React from 'react'
import type { Tool } from './useTool'

export interface ToolbarProps {
  tool: Tool
  setTool(t: Tool): void
  canEdit: boolean
  onCreateSticky(): void
}

export function Toolbar({ tool, setTool, canEdit, onCreateSticky }: ToolbarProps) {
  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
  }

  return (
    <div
      data-testid="left-toolbar"
      role="toolbar"
      aria-label="Left toolbar"
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px',
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        zIndex: 10,
        pointerEvents: 'auto',
      }}
    >
      {/* Select tool (V) */}
      <button
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        onClick={() => setTool('select')}
        style={{
          width: 36,
          height: 36,
          border: tool === 'select' ? '2px solid #4285f4' : '1px solid rgba(0,0,0,0.2)',
          borderRadius: 6,
          background: tool === 'select' ? 'rgba(66,133,244,0.15)' : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <svg
          width="18" height="18" viewBox="0 0 18 18" fill="none"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
          style={{ pointerEvents: 'none' }}
        >
          <path d="M4 2l10 7-4.5 1L12 15l-2.5 1-2.5-5L4 13V2z"
            fill="rgba(0,0,0,0.7)" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5"/>
        </svg>
      </button>

      {/* Text tool (T) */}
      <button
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        disabled={!canEdit}
        onClick={() => canEdit && setTool('text')}
        style={{
          width: 36,
          height: 36,
          border: tool === 'text' ? '2px solid #4285f4' : '1px solid rgba(0,0,0,0.2)',
          borderRadius: 6,
          background: tool === 'text' ? 'rgba(66,133,244,0.15)' : 'transparent',
          cursor: canEdit ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          opacity: canEdit ? 1 : 0.4,
          fontWeight: 'bold',
          fontSize: 14,
          color: tool === 'text' ? '#4285f4' : 'rgba(0,0,0,0.7)',
        }}
      >
        T
      </button>

      {/* Sticky note button (N) */}
      <button
        data-testid="create-sticky-btn"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={onCreateSticky}
        style={{
          width: 36,
          height: 36,
          border: '1px solid rgba(0,0,0,0.2)',
          borderRadius: 6,
          background: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          outline: 'none',
        }}
      >
        <svg
          width="20" height="20" viewBox="0 0 20 20" fill="none"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
          style={{ pointerEvents: 'none' }}
        >
          <rect x="2" y="2" width="16" height="16" rx="2"
            fill="#FFF176" stroke="rgba(0,0,0,0.3)" strokeWidth="1"/>
          <path d="M5 7h10M5 11h7" stroke="rgba(0,0,0,0.45)"
            strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}
