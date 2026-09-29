/**
 * Compute the full share link for a board.
 */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}
