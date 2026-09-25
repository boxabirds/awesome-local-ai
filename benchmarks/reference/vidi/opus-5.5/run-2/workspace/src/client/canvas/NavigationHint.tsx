/** First-use hint, shown until the first pan or zoom of the visit (anchor: nav.hint_display). */
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint(props: { visible: boolean }): React.JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" role="note" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
