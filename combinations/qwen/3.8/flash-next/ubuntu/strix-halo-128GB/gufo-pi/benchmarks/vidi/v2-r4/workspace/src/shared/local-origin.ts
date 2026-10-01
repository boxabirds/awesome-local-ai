/**
 * The origin tag for every local mutation. Stories use this for undo
 * tracking and for filtering echo updates from the sync provider.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');
