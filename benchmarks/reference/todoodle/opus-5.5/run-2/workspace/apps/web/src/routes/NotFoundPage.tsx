import { RememberedList } from '@/features/remembered/RememberedList';
import { NotFound } from './NotFound';

/**
 * The not-found page with this browser's remembered workspaces in its recovery slot, so a bad or
 * cut-off link isn't a dead end. NotFound itself stays free of story-3 imports.
 */
export function NotFoundPage() {
  return <NotFound recovery={<RememberedList variant="notfound" />} />;
}
