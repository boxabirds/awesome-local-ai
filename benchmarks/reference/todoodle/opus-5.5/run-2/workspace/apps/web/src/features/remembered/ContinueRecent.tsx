import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { buttonClasses } from '@/components/ui/button';
import { rememberedQuery } from './api';
import { pickContinueTarget } from './pickContinueTarget';
import { warmWorkspace } from './warmWorkspace';

/** The Continue target, derived from the shared list query (no extra request). */
export function useContinueTarget() {
  return useQuery({ ...rememberedQuery, select: pickContinueTarget }).data ?? null;
}

/**
 * "Continue to <most recent>": the primary action for a returning visitor. Nothing while the list
 * loads, fails, or holds no openable workspace. Never navigates by itself.
 */
export function ContinueRecent() {
  const client = useQueryClient();
  const target = useContinueTarget();
  if (!target) return null;
  const warm = () => warmWorkspace(client, target.id);
  return (
    <Link
      to={`/w/${target.id}`}
      className={buttonClasses('default', 'lg', 'w-full max-w-full sm:w-auto sm:self-start')}
      onPointerEnter={warm}
      onFocus={warm}
    >
      <span className="truncate">{`Continue to ${target.name}`}</span>
    </Link>
  );
}
