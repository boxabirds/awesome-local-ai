/**
 * First-use navigation hint, bottom centre. Shown while the user has not yet
 * panned or zoomed during this visit; hidden (for the rest of the visit) by
 * the first camera change. Not persisted: a page reload shows it again.
 */
export function NavigationHint(props: { visible: boolean }) {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
