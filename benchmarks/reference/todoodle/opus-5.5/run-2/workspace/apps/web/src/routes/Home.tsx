import { ContinueRecent, useContinueTarget } from '@/features/remembered/ContinueRecent';
import { RememberedList } from '@/features/remembered/RememberedList';
import { StartButton } from '@/features/workspace/StartButton';

const hero = (
  <>
    <h1 className="text-4xl font-bold tracking-tight">Todoodle</h1>
    <p className="text-muted-foreground text-lg">
      A calm place to capture tasks and get them done, together. No sign-up needed.
    </p>
  </>
);

/**
 * Returning visitor: Continue, this browser's workspaces, then a secondary Start. First visit:
 * Start (primary) with a hint about links. Never redirects on its own.
 */
export function Home() {
  const hasContinue = useContinueTarget() !== null;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-4">{hero}</div>
      <ContinueRecent />
      <RememberedList variant="home" />
      <StartButton variant={hasContinue ? 'secondary' : 'primary'} />
    </main>
  );
}
