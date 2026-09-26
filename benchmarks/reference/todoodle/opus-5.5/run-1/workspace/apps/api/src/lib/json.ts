import { hasBody } from '../middleware/validate.ts';

/** Reads a JSON body; undefined when there is none, null when it is not valid JSON. */
export async function readJson(req: Request): Promise<unknown> {
  if (!hasBody(req)) return undefined;
  try {
    return await req.json();
  } catch {
    return null;
  }
}
