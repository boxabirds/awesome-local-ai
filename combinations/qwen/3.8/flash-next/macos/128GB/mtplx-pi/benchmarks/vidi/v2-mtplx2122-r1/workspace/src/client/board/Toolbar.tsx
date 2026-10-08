import React from 'react'

export interface ToolbarProps {
  onCreateSticky(): void
}

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  function handlePointerDown(e: React.PointerEvent) {
    // Prevent the viewport from seeing this as a click on empty space.
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
      <button
        data-testid="create-sticky-btn"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
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
