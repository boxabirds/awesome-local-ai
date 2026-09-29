export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint(props: { visible: boolean }) {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" role="note">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
