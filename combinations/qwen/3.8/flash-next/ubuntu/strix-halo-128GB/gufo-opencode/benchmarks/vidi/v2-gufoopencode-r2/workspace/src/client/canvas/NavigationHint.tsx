export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint({ visible }: { visible: boolean }): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
