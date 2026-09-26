// The 'Show completed' choice, remembered per workspace and list on this browser (prd.remember_show_completed).
// Storage can be unavailable (private mode, blocked site data): every access is guarded, failures read as
// off and writes are dropped, so the list never breaks because of it.

export function showCompletedKey(workspaceId: string, listKey: string): string {
  return `tdl:showCompleted:${workspaceId}:${listKey}`;
}

export function readShowCompleted(storage: Storage | undefined, workspaceId: string, listKey: string): boolean {
  try {
    return storage?.getItem(showCompletedKey(workspaceId, listKey)) === '1';
  } catch {
    return false;
  }
}

export function writeShowCompleted(storage: Storage | undefined, workspaceId: string, listKey: string, on: boolean): void {
  try {
    storage?.setItem(showCompletedKey(workspaceId, listKey), on ? '1' : '0');
  } catch {
    // Not remembered this time; the toggle itself still works.
  }
}

/** window.localStorage, or undefined where even reading the property throws. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
