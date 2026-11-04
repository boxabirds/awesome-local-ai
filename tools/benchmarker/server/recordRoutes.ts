// The record routes (story 23, readers.benchmarker): a run's result documents, as read from the lake, served by the
// app at the addresses shared/recordLinks.ts builds. A held-out result in full is never served.
import { RECORD_ROUTE, recordHref } from "../shared/recordLinks.ts";

export { RECORD_ROUTE };

/** A re-scored story's full result: private since 30 Sep 2026 (records from before have it public, but it is never
 * shown here either way; the public summary is accept-summary.json). */
const PRIVATE_DOCUMENT = "accept.json";
const TYPE_TEXT = "text/plain; charset=utf-8";
const TYPE_JSON = "application/json; charset=utf-8";
const TYPE_HTML = "text/html; charset=utf-8";

const isPrivate = (path: string) => path.split("/").at(-1) === PRIVATE_DOCUMENT;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The response to GET `path` (under /record/), or null when there is nothing to serve (404). */
export function recordResponse(documents: Map<string, string>, path: string): { contentType: string; body: string } | null {
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(RECORD_ROUTE.length));
  } catch {
    return null;
  }
  if (!rest) return null;
  if (rest.endsWith("/")) {
    const dir = rest.slice(0, -1);
    const names = [...documents.keys()].filter((k) => k.startsWith(rest) && !isPrivate(k)).map((k) => k.slice(rest.length)).sort();
    if (!names.length) return null;
    const items = names.map((n) => `<li><a href="${escape(recordHref(dir, n))}">${escape(n)}</a></li>`).join("\n");
    return { contentType: TYPE_HTML, body: `<!doctype html>\n<meta charset="utf-8">\n<title>${escape(dir)}</title>\n<h1>${escape(dir)}</h1>\n<ul>\n${items}\n</ul>\n` };
  }
  const text = isPrivate(rest) ? undefined : documents.get(rest);
  if (text === undefined) return null;
  return { contentType: rest.endsWith(".json") ? TYPE_JSON : TYPE_TEXT, body: text };
}
