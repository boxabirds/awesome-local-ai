/**
 * This tab's id, generated once at module load. api.ts sends it as X-Todoodle-Client-Id on every
 * request; the server stamps it on the live events our writes cause, so this tab can ignore its own echoes.
 */
export const clientId: string = crypto.randomUUID();
