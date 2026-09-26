import { useQuery, useQueryClient } from '@tanstack/react-query';
import Check from 'lucide-react/icons/check';
import ChevronDown from 'lucide-react/icons/chevron-down';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { rememberedQuery } from './api';
import { ForgetDialogSlot } from './ForgetDialogSlot';
import { preloadForgetDialog } from './forgetDialogLoader';
import { prefetchWorkspace } from './prefetchWorkspace';

type Props = { currentId: string; currentName: string };

type Item = { id: string; name: string };

/**
 * Quick switching between this browser's remembered workspaces, from the workspace header. Lists the
 * available ones (current checked), then 'Forget this workspace on this browser' and 'All workspaces'.
 * Hovering or focusing an item warms its data and the route chunk, once per item per menu open.
 */
export function WorkspaceSwitcher({ currentId, currentName }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  // Ids already prefetched during this open (rerender-use-ref-transient-values); cleared on close.
  const prefetched = useRef(new Set<string>());
  // The list is loaded when the menu is first wanted (hover/focus/open), then shared through the cache.
  const list = useQuery({ ...rememberedQuery, enabled: open });

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) void preloadForgetDialog();
    else prefetched.current.clear();
  }, []);

  const warmList = useCallback(() => void queryClient.prefetchQuery(rememberedQuery), [queryClient]);

  const warmItem = useCallback(
    (id: string) => {
      if (prefetched.current.has(id)) return;
      prefetched.current.add(id);
      prefetchWorkspace(queryClient, id);
    },
    [queryClient],
  );

  const select = useCallback(
    (id: string) => {
      if (id !== currentId) navigate(`/w/${id}`);
    },
    [currentId, navigate],
  );

  const goHome = useCallback(() => navigate('/'), [navigate]);

  // Available entries only; on error (or before loading) just the current workspace.
  const items: Item[] = [];
  for (const entry of list.data ?? []) {
    if (entry.available && entry.name !== null) items.push({ id: entry.id, name: entry.id === currentId ? currentName : entry.name });
  }
  if (!items.some((item) => item.id === currentId)) items.unshift({ id: currentId, name: currentName });

  return (
    <>
      <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Switch workspace" className="touch-target" onPointerEnter={warmList} onFocus={warmList}>
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              aria-current={item.id === currentId ? 'page' : undefined}
              onSelect={() => select(item.id)}
              onPointerEnter={() => warmItem(item.id)}
              onFocus={() => warmItem(item.id)}
            >
              <Check aria-hidden="true" className={item.id === currentId ? '' : 'invisible'} />
              <span className="truncate">{item.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {list.isError ? null : (
            <DropdownMenuItem onSelect={() => setForgetOpen(true)}>Forget this workspace on this browser</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={goHome}>All workspaces</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ForgetDialogSlot
        workspace={{ id: currentId, name: currentName }}
        open={forgetOpen}
        onOpenChange={setForgetOpen}
        onForgotten={goHome}
      />
    </>
  );
}
