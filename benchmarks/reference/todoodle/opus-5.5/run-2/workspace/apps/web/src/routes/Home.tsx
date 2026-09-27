import { StartButton } from '@/features/workspace/StartButton';

const hero = (
  <>
    <h1 className="text-4xl font-bold tracking-tight">Todoodle</h1>
    <p className="text-muted-foreground text-lg">
      A calm place to capture tasks and get them done, together. No sign-up needed.
    </p>
  </>
);

export function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-4">{hero}</div>
      {/* Story 3 inserts this browser's remembered workspaces here, above the button. */}
      <StartButton />
    </main>
  );
}
