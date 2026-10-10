export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom'}
    </div>
  );
}
