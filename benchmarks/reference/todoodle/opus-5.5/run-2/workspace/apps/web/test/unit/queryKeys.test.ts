import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

const workspaceScoped = (id: string) => [queryKeys.workspace(id), queryKeys.link(id)];

describe('queryKeys', () => {
  it('TC-83 every workspace-scoped key starts with root(id)', () => {
    expect(queryKeys.root(ID)).toEqual(['ws', ID]);
    for (const key of workspaceScoped(ID)) expect(key.slice(0, 2)).toEqual(queryKeys.root(ID));
    expect(queryKeys.workspace(ID)).toEqual(['ws', ID, 'workspace']);
    expect(queryKeys.link(ID)).toEqual(['ws', ID, 'link']);
  });

  it('TC-83 remembered keys are outside the root', () => {
    expect(queryKeys.remembered()).toEqual(['remembered']);
    expect(queryKeys.rememberedTouch(ID)).toEqual(['remembered-touch', ID]);
    expect(queryKeys.remembered()[0]).not.toBe('ws');
    expect(queryKeys.rememberedTouch(ID)[0]).not.toBe('ws');
  });

  it('TC-83 invalidating root(id) reaches every key for that workspace and nothing else', async () => {
    const client = new QueryClient();
    const all = [
      ...workspaceScoped(ID),
      ...workspaceScoped(OTHER),
      queryKeys.remembered(),
      queryKeys.rememberedTouch(ID),
    ];
    for (const key of all) client.setQueryData(key, 'x');
    await client.invalidateQueries({ queryKey: queryKeys.root(ID) });
    const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    for (const key of workspaceScoped(ID)) expect(invalidated(key)).toBe(true);
    for (const key of workspaceScoped(OTHER)) expect(invalidated(key)).toBe(false);
    expect(invalidated(queryKeys.remembered())).toBe(false);
    expect(invalidated(queryKeys.rememberedTouch(ID))).toBe(false);
  });
});
