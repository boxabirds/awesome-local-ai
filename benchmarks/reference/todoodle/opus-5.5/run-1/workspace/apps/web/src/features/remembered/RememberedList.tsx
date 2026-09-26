import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { rememberedQuery } from './api';
import { HomeEmptyHint } from './HomeEmptyHint';
import { RememberedRow } from './RememberedRow';
import { RememberedSkeleton } from './RememberedSkeleton';

type Props = { variant: 'home' | 'notfound' };

/**
 * This browser's remembered workspaces, most recently opened first. On Home it also shows the empty
 * hint and a Retry on failure; on the not-found page it renders nothing unless there is a list.
 * It never blocks 'Start a new list', which lives outside it.
 */
export function RememberedList({ variant }: Props) {
  const { data, isPending, isError, refetch } = useQuery(rememberedQuery);
  const home = variant === 'home';

  return isPending ? (
    <RememberedSkeleton />
  ) : isError ? (
    home ? (
      <div role="alert" className="flex items-center gap-3">
        <p>Couldn't load your workspaces</p>
        <Button variant="outline" size="sm" className="touch-target" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    ) : null
  ) : data.length === 0 ? (
    home ? (
      <HomeEmptyHint />
    ) : null
  ) : (
    <section aria-labelledby={`remembered-heading-${variant}`} className="flex flex-col gap-2">
      <h2 id={`remembered-heading-${variant}`} className="text-sm font-semibold text-muted-foreground">
        Your workspaces on this browser
      </h2>
      <ul className="flex flex-col gap-1">
        {data.map((entry) => (
          <RememberedRow
            key={entry.id}
            id={entry.id}
            name={entry.name}
            lastOpenedAt={entry.lastOpenedAt}
            available={entry.available}
          />
        ))}
      </ul>
    </section>
  );
}
