// Story 6 (identity) is not implemented yet. A stable per-tab placeholder
// keeps createdBy meaningful across edits in one session; story 6 replaces
// this module with real identity resolution.
export const identity = {
  id: crypto.randomUUID()
};
