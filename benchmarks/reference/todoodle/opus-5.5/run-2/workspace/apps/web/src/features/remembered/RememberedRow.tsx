import Ellipsis from 'lucide-react/icons/ellipsis';
import { memo, useRef } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { preloadWorkspaceRoute } from '@/features/workspace/preloadWorkspaceRoute';
import { useHoverNone } from '@/lib/useHoverNone';
import { cn } from '@/lib/utils';
import { preloadForgetDialog } from './forgetDialogLoader';
import { relativeTime } from './relativeTime';

export type RememberedRowProps = {
  id: string;
  name: string | null;
  lastOpenedAt: string;
  available: boolean;
  onForget(id: string, name: string, trigger: HTMLElement | null): void;
  onRemove(id: string): void;
};

/** With a mouse the "..." appears on row hover or keyboard focus; on touch it is always visible. */
const HOVER_REVEAL =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100';

const preload = () => void preloadForgetDialog();

/** One remembered workspace: a link when it can be opened, a greyed "Unavailable" row otherwise. */
export const RememberedRow = memo(function RememberedRow({
  id,
  name,
  lastOpenedAt,
  available,
  onForget,
  onRemove,
}: RememberedRowProps) {
  const touch = useHoverNone();
  const trigger = useRef<HTMLButtonElement>(null);
  const opened = `Opened ${relativeTime(lastOpenedAt)}`;

  if (!available || name === null) {
    return (
      <li className="flex items-center gap-2 rounded-md px-3 py-2 opacity-60" data-available="false">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Unavailable</span>
          <span className="text-muted-foreground text-sm">{opened}</span>
        </div>
        <Button variant="ghost" size="sm" className="touch-target" onClick={() => onRemove(id)}>
          Remove
        </Button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1 rounded-md hover:bg-muted focus-within:bg-muted" data-available="true">
      <Link
        to={`/w/${id}`}
        onPointerEnter={preloadWorkspaceRoute}
        onFocus={preloadWorkspaceRoute}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="truncate font-medium">{name}</span>
        <span className="text-muted-foreground text-sm">{opened}</span>
      </Link>
      <DropdownMenu onOpenChange={(open) => (open ? preload() : undefined)}>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={`More actions for ${name}`}
            className={cn(
              'touch-target inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-background focus-visible:outline-2 focus-visible:outline-ring',
              touch ? 'opacity-100' : HOVER_REVEAL,
            )}
            onPointerEnter={preload}
            onFocus={preload}
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onForget(id, name, trigger.current)}>Forget on this browser</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
});
