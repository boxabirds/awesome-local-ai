/** The Workspace route chunk. Shared by React.lazy in App and the preload on the Start button. */
export const loadWorkspaceRoute = () => import('./Workspace.tsx');

// ---------------------------------------------------------------- story 7: the project view chunk

/** Test hook: how many times the project view chunk was requested (TC-84). Never read by the app. */
export const projectViewLoads = { count: 0 };

let projectView: Promise<typeof import('./ProjectView.tsx')> | null = null;

/**
 * The project view route chunk (bundle-dynamic-imports). Sidebar rows call it on hover and focus
 * (bundle-preload), so it is usually loaded before the project is opened. Idempotent; a failed load is
 * forgotten so the next attempt retries.
 */
export function preloadProjectView(): Promise<typeof import('./ProjectView.tsx')> {
  if (!projectView) {
    projectViewLoads.count++;
    projectView = import('./ProjectView.tsx').catch((error: unknown) => {
      projectView = null;
      throw error;
    });
  }
  return projectView;
}
