export interface NavigationHintProps {
  readonly visible: boolean;
}

/** Bottom-centre first-use navigation hint; hidden once the user has navigated. */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) {
    return null;
  }
  return (
    <div className="navigation-hint" data-board-chrome="true" data-testid="navigation-hint">
      {'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom'}
    </div>
  );
}
