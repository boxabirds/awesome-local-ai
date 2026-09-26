// Module-level and cached (js-cache-function-results): one PluralRules for every dialog.
const plural = new Intl.PluralRules('en');

/**
 * The delete confirmation's question. `total` is the project's open + completed tasks: exactly what the
 * deletion removes (prd.delete_project_warning), so the warning and the effect agree.
 */
export function deleteProjectQuestion(name: string, total: number): string {
  if (total <= 0) return `Delete "${name}"?`;
  return `Delete "${name}" and its ${total} ${plural.select(total) === 'one' ? 'task' : 'tasks'}?`;
}
