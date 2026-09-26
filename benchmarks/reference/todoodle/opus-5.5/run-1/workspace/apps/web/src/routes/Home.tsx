import Plus from 'lucide-react/icons/plus';
import { Button } from '@/components/ui/button';
import { useCreateWorkspace } from '@/features/workspace/useCreateWorkspace';
import { loadWorkspaceRoute } from './lazy.ts';

// Static hero markup, hoisted out of render (rendering-hoist-jsx).
const hero = (
  <>
    <h1 className="text-4xl font-bold tracking-tight">Todoodle</h1>
    <p className="text-lg text-muted-foreground">
      A shared to-do list for getting things done together. No sign-up, just a link.
    </p>
  </>
);

function preloadWorkspace() {
  void loadWorkspaceRoute();
}

export function Home() {
  const create = useCreateWorkspace();
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 px-6">
      <title>Todoodle</title>
      {hero}
      {/* Story 3 renders this browser's remembered workspaces here, above the button. */}
      <div className="flex flex-col items-start gap-2">
        <Button
          size="lg"
          disabled={create.isPending}
          onClick={() => create.mutate()}
          onPointerEnter={preloadWorkspace}
          onFocus={preloadWorkspace}
        >
          <Plus aria-hidden="true" />
          Start a new list
        </Button>
        {create.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't create your list — try again
          </p>
        ) : null}
      </div>
    </main>
  );
}
