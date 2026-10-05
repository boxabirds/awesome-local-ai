/**
 * Module-level identity holder. The board session has one identity (a random id
 * generated on page load) and there is only one board open at a time.
 */
let _identityId = '';

export function setIdentityId(id: string): void {
  _identityId = id;
}

export function getIdentityId(): string {
  return _identityId;
}
