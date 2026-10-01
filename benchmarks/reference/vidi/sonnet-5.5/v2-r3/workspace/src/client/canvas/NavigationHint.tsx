export function NavigationHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <div className="navigation-hint">Drag to move around · Ctrl/Cmd + scroll or pinch to zoom</div>;
}
