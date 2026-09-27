type WorkspaceModule = typeof import('@/routes/Workspace');

let loading: Promise<WorkspaceModule> | undefined;
let loaded: WorkspaceModule | undefined;

/** The Workspace route chunk (the same chunk for /w and /w/:id), requested at most once. */
export function loadWorkspaceRoute(): Promise<WorkspaceModule> {
  return (loading ??= import('@/routes/Workspace').then((module) => (loaded = module)));
}

/** Warms the chunk before the click lands (Start, Continue, list rows, switcher, idle on Home). */
export function preloadWorkspaceRoute(): void {
  void loadWorkspaceRoute();
}

/**
 * The chunk if it has already arrived. Rendering it directly skips React.lazy's suspend-and-retry,
 * which React throttles (~300 ms after a fallback) and would delay the instant workspace name.
 */
export function loadedWorkspaceRoute(): WorkspaceModule | undefined {
  return loaded;
}
