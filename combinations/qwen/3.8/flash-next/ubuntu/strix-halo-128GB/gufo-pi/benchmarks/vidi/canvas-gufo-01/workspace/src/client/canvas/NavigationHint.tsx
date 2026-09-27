// One-line usage hint (story 1). Dismissable so it never sits under the work.

import { useState } from 'react';

export function NavigationHint() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="navigation-hint" role="note">
      Drag on empty canvas to move · Ctrl/Cmd + scroll or pinch to zoom · double-click to add a note
      <button type="button" className="hint-dismiss" aria-label="Dismiss hint" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
