import Plus from 'lucide-react/icons/plus';
import { Button } from '@/components/ui/button';
import { useCreateWorkspace } from './useCreateWorkspace';

/** Warms the lazy Workspace route chunk before the click lands. */
const preloadWorkspaceRoute = () => void import('@/routes/Workspace');

/** 'Start a new list': one click creates a workspace. Shared by Home and NotFound. */
export function StartButton() {
  const create = useCreateWorkspace();
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        size="lg"
        disabled={create.isPending}
        onClick={() => create.mutate()}
        onPointerEnter={preloadWorkspaceRoute}
        onFocus={preloadWorkspaceRoute}
      >
        <Plus aria-hidden="true" className="size-5" />
        Start a new list
      </Button>
      {create.isError ? (
        <p role="alert" className="text-destructive text-sm">
          Couldn't create your list — try again
        </p>
      ) : null}
    </div>
  );
}
