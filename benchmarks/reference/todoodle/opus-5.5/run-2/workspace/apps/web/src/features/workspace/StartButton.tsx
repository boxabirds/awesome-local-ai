import Plus from 'lucide-react/icons/plus';
import { Button } from '@/components/ui/button';
import { preloadWorkspaceRoute } from './preloadWorkspaceRoute';
import { useCreateWorkspace } from './useCreateWorkspace';

/**
 * 'Start a new list': one click creates a workspace. Shared by Home and NotFound. Secondary on
 * Home when 'Continue to ...' is the primary action.
 */
export function StartButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const create = useCreateWorkspace();
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        size="lg"
        variant={variant === 'primary' ? 'default' : 'secondary'}
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
