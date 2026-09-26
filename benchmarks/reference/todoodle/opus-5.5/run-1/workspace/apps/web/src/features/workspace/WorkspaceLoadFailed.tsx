import { Button } from '@/components/ui/button';

/** Network or server failure while loading. Never used for 'not found'. */
export function WorkspaceLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 px-6">
      <title>Todoodle</title>
      <div role="alert" className="flex flex-col items-start gap-4">
        <p className="text-lg">Couldn't load this workspace.</p>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </main>
  );
}
