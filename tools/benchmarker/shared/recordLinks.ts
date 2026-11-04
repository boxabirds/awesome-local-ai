// A run's record, as the app serves it (story 23): the result documents the server read from the lake, at
// /record/<run's folder>/<document>. The run's folder is its checkout-relative path (row.dir). Records are no longer
// on a repository host, so links stay in the app.

export const RECORD_ROUTE = "/record/";

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** The address of a run's record (the list of its documents), or of one document below the run's folder. */
export function recordHref(dir: string, file?: string): string {
  return `${RECORD_ROUTE}${encodePath(dir)}/${file ? encodePath(file) : ""}`;
}
