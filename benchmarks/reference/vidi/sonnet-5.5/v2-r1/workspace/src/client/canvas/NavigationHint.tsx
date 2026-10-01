export function NavigationHint(props: { visible: boolean }) {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
