import { useQuery, useQueryClient } from '@tanstack/react-query';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { rememberedQuery } from './api';
import { pickContinueTarget } from './pickContinueTarget';
import { prefetchWorkspace } from './prefetchWorkspace';

/** Shared with Home (to decide whether Start is primary); module-level so `select` stays stable. */
export const continueTargetQuery = { ...rememberedQuery, select: pickContinueTarget };

/**
 * 'Continue to <most recent>': the large primary action on Home when this browser remembers an available
 * workspace. Nothing while loading, on error or when nothing is available. It never navigates by itself.
 */
export function ContinueRecent() {
  const queryClient = useQueryClient();
  const { data: target } = useQuery(continueTargetQuery);
  const targetId = target?.id;
  const warm = useCallback(() => {
    if (targetId) prefetchWorkspace(queryClient, targetId);
  }, [queryClient, targetId]);

  return target ? (
    <Link
      to={`/w/${target.id}`}
      data-variant="primary"
      className={cn(buttonVariants({ size: 'lg' }), 'touch-target h-auto min-h-14 w-full justify-between py-3 text-lg')}
      onPointerEnter={warm}
      onFocus={warm}
    >
      <span className="truncate">{`Continue to ${target.name}`}</span>
      <ArrowRight aria-hidden="true" />
    </Link>
  ) : null;
}
