export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use navigation hint shown bottom-centre. It is dismissed for the rest
 * of the visit on the first camera change and is not persisted, so a reload
 * shows it again (PRD nav.hint, "Does not remember the view after reload").
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div
      data-testid="navigation-hint"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        padding: '6px 12px',
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        fontSize: 13,
        color: '#333',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}