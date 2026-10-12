// The mini project's TypeScript module: one function, fully covered by core.test.ts.
export function titleOf(run: { title?: string }): string {
  return run.title ?? "untitled"
}
