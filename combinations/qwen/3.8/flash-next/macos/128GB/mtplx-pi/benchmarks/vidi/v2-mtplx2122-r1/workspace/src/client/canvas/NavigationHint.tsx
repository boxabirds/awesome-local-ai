import React from 'react'

export interface NavigationHintProps {
  visible: boolean
}

export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom'

export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null
  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid #ccc',
        borderRadius: 4,
        padding: '0.4rem 0.75rem',
        fontSize: '0.875rem',
        color: '#444',
        whiteSpace: 'nowrap',
        zIndex: 999,
        pointerEvents: 'none',
      }}
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  )
}
