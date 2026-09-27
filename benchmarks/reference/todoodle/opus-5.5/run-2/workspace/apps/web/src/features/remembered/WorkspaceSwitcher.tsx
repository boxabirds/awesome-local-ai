import { useQuery, useQueryClient } from '@tanstack/react-query';
import ChevronsUpDown from 'lucide-react/icons/chevrons-up-down';
import { memo, Suspense, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { rememberedQuery } from './api';
import { LazyForgetDialog, preloadForgetDialog } from './forgetDialogLoader';
import { warmWorkspace } from './warmWorkspace';

export const FORGET_CURRENT = 'Forget this workspace on this browser';
export const ALL_WORKSPACES = 'All workspaces';

type Item = { id: string; name: string };

const SwitcherItem = memo(function SwitcherItem({
  id,
  name,
  current,
  onWarm,
  onPick,
}: {
  id: string;
  name: string;
  current: boolean;
  onWarm(id: string): void;
  onPick(id: string): void;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={current}
      onSelect={() => onPick(id)}
      onPointerEnter={() => onWarm(id)}
      onFocus={() => onWarm(id)}
    >
      <span className="truncate">{name}</span>
    </DropdownMenuCheckboxItem>
  );
});

/**
 * Quick switching between this browser's workspaces, on the workspace name in the header. The
 * current one is checked; unavailable ones are left out. If the list can't load, only the current
 * workspace and "All workspaces" are offered.
 */
export function WorkspaceSwitcher({ currentId, currentName }: { currentId: string; currentName: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery(rememberedQuery);
  const trigger = useRef<HTMLButtonElement>(null);
  // Ids warmed during this menu open: each is prefetched at most once per open.
  const warmed = useRef(new Set<string>());
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetMounted, setForgetMounted] = useState(false);

  const available: Item[] = [];
  for (const w of data ?? []) if (w.available && w.name !== null) available.push({ id: w.id, name: w.name });
  const items = available.some((w) => w.id === currentId) ? available : [{ id: currentId, name: currentName }, ...available];

  const onOpenChange = useCallback((open: boolean) => {
    if (open) void preloadForgetDialog();
    else warmed.current.clear();
  }, []);

  const onWarm = useCallback(
    (id: string) => {
      if (id === currentId || warmed.current.has(id)) return;
      warmed.current.add(id);
      warmWorkspace(client, id);
    },
    [client, currentId],
  );

  const onPick = useCallback(
    (id: string) => {
      if (id !== currentId) navigate(`/w/${id}`);
    },
    [navigate, currentId],
  );

  const onForgotten = useCallback(() => navigate('/'), [navigate]);

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label="Switch workspace"
            className="touch-target inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronsUpDown aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-80">
          <DropdownMenuLabel className="px-2 py-1 text-xs text-muted-foreground">Your workspaces on this browser</DropdownMenuLabel>
          {items.map((w) => (
            <SwitcherItem key={w.id} id={w.id} name={w.name} current={w.id === currentId} onWarm={onWarm} onPick={onPick} />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setForgetMounted(true);
              setForgetOpen(true);
            }}
          >
            {FORGET_CURRENT}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/')}>{ALL_WORKSPACES}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {forgetMounted ? (
        <Suspense fallback={null}>
          <LazyForgetDialog
            workspace={{ id: currentId, name: currentName }}
            open={forgetOpen}
            onOpenChange={setForgetOpen}
            onForgotten={onForgotten}
            returnFocusTo={trigger.current}
          />
        </Suspense>
      ) : null}
    </>
  );
}
