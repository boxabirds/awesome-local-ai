/**
 * First-use navigation hint. Visibility is driven by `useCamera`'s
 * `hasNavigated` latch; it is not persisted, so a reload shows it again.
 */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint(props: NavigationHintProps) {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
