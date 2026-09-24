export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/** Bottom-centre first-use hint; the parent hides it after the first pan or zoom. */
export function NavigationHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
