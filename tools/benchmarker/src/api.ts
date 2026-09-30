// Changing requests to the benchmarker's own server: JSON, with the header that marks them as the page's.
export async function change<T = { ok: boolean; message: string }>(method: "POST" | "DELETE", url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Benchmarker": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await r.json()) as T;
}
