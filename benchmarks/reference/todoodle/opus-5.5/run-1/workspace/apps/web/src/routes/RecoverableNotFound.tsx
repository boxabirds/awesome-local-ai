import { RememberedList } from '@/features/remembered/RememberedList';
import { NotFound } from './NotFound.tsx';

/**
 * Story 2's NotFound with this browser's remembered workspaces in its recovery slot, so a mistyped or
 * cut-off link is not a dead end. NotFound itself stays free of story 3 imports.
 */
export function RecoverableNotFound() {
  return <NotFound recovery={<RememberedList variant="notfound" />} />;
}
