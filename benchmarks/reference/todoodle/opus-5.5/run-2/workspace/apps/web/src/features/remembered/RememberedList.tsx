import { useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { rememberedQuery, useForgetRemembered } from './api';
import { LazyForgetDialog } from './forgetDialogLoader';
import { HomeEmptyHint } from './HomeEmptyHint';
import { RememberedRow } from './RememberedRow';
import { RememberedSkeleton } from './RememberedSkeleton';

export const LIST_HEADING = 'Your workspaces on this browser';
export const LIST_FAILED = "Couldn't load your workspaces";

type ForgetTarget = { id: string; name: string; returnFocusTo: HTMLElement | null };

/**
 * This browser's remembered workspaces. On Home: skeleton, error with Retry, the empty hint, or
 * the list. On the not-found page ('notfound'): skeleton or the list; nothing when empty or failed.
 */
export function RememberedList({ variant }: { variant: 'home' | 'notfound' }) {
  const query = useQuery(rememberedQuery);
  const { mutate: forget } = useForgetRemembered();
  const [target, setTarget] = useState<ForgetTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const onForget = useCallback((id: string, name: string, returnFocusTo: HTMLElement | null) => {
    setTarget({ id, name, returnFocusTo });
    setDialogOpen(true);
  }, []);
  // Unavailable rows: nothing openable is lost, so no confirmation.
  const onRemove = useCallback((id: string) => forget(id), [forget]);

  const home = variant === 'home';

  return (
    <>
      {query.isPending ? (
        <RememberedSkeleton />
      ) : query.isError ? (
        home ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-destructive">{LIST_FAILED}</p>
            <Button variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null
      ) : query.data.length === 0 ? (
        home ? (
          <HomeEmptyHint />
        ) : null
      ) : (
        <section aria-labelledby={`remembered-heading-${variant}`} className="flex flex-col gap-2">
          <h2 id={`remembered-heading-${variant}`} className="text-lg font-semibold">
            {LIST_HEADING}
          </h2>
          <ul className="flex flex-col gap-1">
            {query.data.map((w) => (
              <RememberedRow
                key={w.id}
                id={w.id}
                name={w.name}
                lastOpenedAt={w.lastOpenedAt}
                available={w.available}
                onForget={onForget}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </section>
      )}
      {target ? (
        <Suspense fallback={null}>
          <LazyForgetDialog
            workspace={{ id: target.id, name: target.name }}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            returnFocusTo={target.returnFocusTo}
          />
        </Suspense>
      ) : null}
    </>
  );
}
