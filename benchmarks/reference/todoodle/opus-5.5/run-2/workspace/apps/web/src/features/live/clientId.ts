/** Header that tells the server which tab made a write, so that tab can ignore its own echo. */
export const CLIENT_ID_HEADER = 'X-Todoodle-Client-Id';

/** This tab's identity: generated once at module load, never persisted. */
export const clientId: string = crypto.randomUUID();
