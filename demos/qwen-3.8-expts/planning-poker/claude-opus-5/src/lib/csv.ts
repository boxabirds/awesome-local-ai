/**
 * Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF.
 * Enough for "paste your backlog export in here" without a dependency.
 */
export function parseDelimited(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d+$/;
const HEADER_HINTS = ["summary", "title", "issue", "key", "name", "description"];

export interface ParsedIssue {
  key: string | null;
  title: string;
}

/**
 * Turns pasted text into issues. Handles three shapes teams actually paste:
 * one title per line, "KEY, Title" CSV, and a Jira/Linear export with a header row.
 */
export function parseIssues(input: string): ParsedIssue[] {
  const rows = parseDelimited(input.trim());
  if (rows.length === 0) return [];

  const first = rows[0].map((c) => c.trim().toLowerCase());
  const looksLikeHeader =
    rows.length > 1 && first.some((cell) => HEADER_HINTS.includes(cell));
  const body = looksLikeHeader ? rows.slice(1) : rows;

  let keyColumn = -1;
  let titleColumn = 0;
  if (looksLikeHeader) {
    keyColumn = first.findIndex((c) => c === "key" || c === "issue key" || c === "id");
    const titleIndex = first.findIndex(
      (c) => c === "summary" || c === "title" || c === "name" || c === "description",
    );
    if (titleIndex >= 0) titleColumn = titleIndex;
  }

  return body
    .map((cells) => {
      const trimmed = cells.map((c) => c.trim());

      if (keyColumn >= 0) {
        return { key: trimmed[keyColumn] || null, title: trimmed[titleColumn] ?? "" };
      }
      // No header: treat a leading ticket-shaped token as the key.
      if (trimmed.length > 1 && ISSUE_KEY_PATTERN.test(trimmed[0])) {
        return { key: trimmed[0], title: trimmed.slice(1).join(" ").trim() };
      }
      return { key: null, title: trimmed.join(" ").trim() };
    })
    .filter((issue) => issue.title.length > 0);
}
