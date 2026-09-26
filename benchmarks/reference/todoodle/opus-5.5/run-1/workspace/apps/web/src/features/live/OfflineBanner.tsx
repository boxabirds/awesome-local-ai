import { deriveLiveUi } from './deriveLiveUi';
import { useNetworkStatus } from './useNetworkStatus';

export const OFFLINE_TEXT = "You're offline — changes can't be saved right now";

/** Top bar while saves can't reach Todoodle. Editing is disabled meanwhile (the shell's fieldset). */
export function OfflineBanner() {
  const { banner } = deriveLiveUi('open', false, useNetworkStatus());
  return banner ? (
    <div role="status" aria-live="polite" className="bg-foreground px-4 py-2 text-center text-sm font-medium text-background">
      {OFFLINE_TEXT}
    </div>
  ) : null;
}
