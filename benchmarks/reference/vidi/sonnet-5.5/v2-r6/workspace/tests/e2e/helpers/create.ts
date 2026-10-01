export const E2E_ORIGIN = 'http://localhost:8799';

/** Creates a board through the real API (what New board does) and returns its id. */
export async function createBoardId(origin: string = E2E_ORIGIN): Promise<string> {
  const res = await fetch(`${origin}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}
