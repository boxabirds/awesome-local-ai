/** Saves can't reach Todoodle: a bar across the top while editing is off. */
export function OfflineBanner() {
  return (
    <div role="status" aria-live="polite" className="bg-warning-surface px-4 py-2 text-center text-sm text-foreground">
      You're offline — changes can't be saved right now
    </div>
  );
}
