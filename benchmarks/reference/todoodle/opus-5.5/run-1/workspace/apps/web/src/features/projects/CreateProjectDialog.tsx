import { MAX_PROJECTS_PER_WORKSPACE, PROJECT_COLOR_KEYS, PROJECT_NAME_MAX, type ProjectColorKey } from '@todoodle/shared/limits';
import type { Project } from '@todoodle/shared/schemas';
import { type FormEvent, useId, useState } from 'react';
import { NameField } from '@/components/NameField';
import { canSaveName, nameFieldState } from '@/components/nameFieldState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ColorPalette } from './ColorPalette';
import { useProjectMutations } from './useProjectMutations';
import { useProjects } from './useProjects';

/** Shown in the create dialog when the workspace already holds MAX_PROJECTS_PER_WORKSPACE projects. */
export const PROJECT_LIMIT_TEXT = `You've reached the limit of ${MAX_PROJECTS_PER_WORKSPACE} projects`;

type Props = {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project was saved: the caller opens it. */
  onCreated: (project: Project) => void;
};

/**
 * '+' in the sidebar: Name (required; Enter submits) and Colour (12 named swatches, the first preselected).
 * The new row shows in the sidebar at once; the dialog closes (and the project opens) once Todoodle has it.
 * Add stays disabled while the name is blank or over PROJECT_NAME_MAX (never cut), at the project limit, or
 * while saving. Lazy chunk, preloaded from the '+' button.
 */
export function CreateProjectDialog({ workspaceId, open, onOpenChange, onCreated }: Props) {
  const actions = useProjectMutations(workspaceId);
  const { data: projects } = useProjects(workspaceId);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ProjectColorKey>(PROJECT_COLOR_KEYS[0]);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [limitFromServer, setLimitFromServer] = useState(false);
  const colourLabelId = useId();
  // Derived during render (rerender-derived-state-no-effect).
  const atLimit = limitFromServer || (projects?.list.length ?? 0) >= MAX_PROJECTS_PER_WORKSPACE;
  const canAdd = canSaveName(name, PROJECT_NAME_MAX) && !atLimit && !saving;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!canAdd) return;
    setSaving(true);
    const outcome = await actions.create({ name: name.trim(), color });
    setSaving(false);
    if (outcome.status === 'created') {
      onOpenChange(false);
      onCreated(outcome.project);
    } else if (outcome.status === 'limit') {
      setLimitFromServer(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} data-create-project>
        <DialogTitle className="text-lg font-semibold">Add project</DialogTitle>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <NameField
            label="Name"
            showLabel
            value={name}
            max={PROJECT_NAME_MAX}
            autoFocus
            onChange={(next) => {
              setName(next);
              setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            emptyHint={touched && nameFieldState(name, PROJECT_NAME_MAX).status === 'empty'}
          />
          <div className="flex flex-col gap-1">
            <span id={colourLabelId} className="text-sm font-medium">
              Colour
            </span>
            <ColorPalette value={color} onChange={setColor} labelledBy={colourLabelId} />
          </div>
          {atLimit ? (
            <DialogDescription role="status" data-limit-message className="text-sm text-destructive">
              {PROJECT_LIMIT_TEXT}
            </DialogDescription>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canAdd} aria-busy={saving || undefined}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
