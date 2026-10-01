export function NavigationHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="nav-hint" role="note">
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
