import { useQueryClient } from '@tanstack/react-query';
import Ellipsis from 'lucide-react/icons/ellipsis';
import { memo, useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useForgetRemembered } from './api';
import { ForgetDialogSlot } from './ForgetDialogSlot';
import { preloadForgetDialog } from './forgetDialogLoader';
import { prefetchWorkspace } from './prefetchWorkspace';
import { relativeTime } from './relativeTime';

type Props = { id: string; name: string | null; lastOpenedAt: string; available: boolean };

function preload() {
  void preloadForgetDialog();
}

/** A row that no longer opens: greyed, not a link, removable at once (nothing openable is lost). */
function UnavailableRow({ id }: { id: string }) {
  const forget = useForgetRemembered();
  return (
    <li aria-disabled="true" className="flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground opacity-60">
      <span className="flex-1">Unavailable</span>
      <Button variant="outline" size="sm" className="touch-target" onClick={() => forget.mutate(id)}>
        Remove
      </Button>
    </li>
  );
}

/**
 * One remembered workspace: a link to /w/:id with its name and last-opened time, and a '...' menu with
 * 'Forget on this browser'. The trigger shows on hover/focus with a mouse and always on touch screens.
 */
export const RememberedRow = memo(function RememberedRow({ id, name, lastOpenedAt, available }: Props) {
  const queryClient = useQueryClient();
  const [forgetOpen, setForgetOpen] = useState(false);
  const onMenuOpenChange = useCallback((open: boolean) => {
    if (open) preload();
  }, []);
  const warm = useCallback(() => prefetchWorkspace(queryClient, id), [queryClient, id]);

  if (!available || name === null) return <UnavailableRow id={id} />;

  return (
    <li className="group flex items-center gap-1 rounded-md hover:bg-muted focus-within:bg-muted">
      <Link
        to={`/w/${id}`}
        className="touch-target flex min-w-0 flex-1 items-baseline justify-between gap-3 rounded-md px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerEnter={warm}
        onFocus={warm}
      >
        <span className="truncate font-medium">{name}</span>
        <span className="shrink-0 text-sm text-muted-foreground">{relativeTime(lastOpenedAt)}</span>
      </Link>
      <DropdownMenu modal={false} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`More actions for ${name}`}
            data-row-menu-trigger
            className="touch-target opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
            onPointerEnter={preload}
            onFocus={preload}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setForgetOpen(true)}>Forget on this browser</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ForgetDialogSlot workspace={{ id, name }} open={forgetOpen} onOpenChange={setForgetOpen} />
    </li>
  );
});
