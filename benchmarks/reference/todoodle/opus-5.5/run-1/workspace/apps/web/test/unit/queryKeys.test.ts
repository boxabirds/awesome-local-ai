import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';

const ID = '0123456789ABCDEF0123456789ABCDEF';
const OTHER = 'FEDCBA9876543210FEDCBA9876543210';

describe('TC-83 query key factory', () => {
  it('every workspace-scoped key starts with root(id)', () => {
    expect(queryKeys.root(ID)).toEqual(['ws', ID]);
    for (const key of [queryKeys.workspace(ID), queryKeys.link(ID)]) {
      expect(key.slice(0, 2)).toEqual(queryKeys.root(ID));
    }
    expect(queryKeys.workspace(ID)).toEqual(['ws', ID, 'workspace']);
    expect(queryKeys.link(ID)).toEqual(['ws', ID, 'link']);
  });

  it('root(id) invalidates every workspace key for that id, and only those', async () => {
    const client = new QueryClient();
    const keys = [
      queryKeys.workspace(ID),
      queryKeys.link(ID),
      queryKeys.workspace(OTHER),
      queryKeys.remembered(),
      queryKeys.rememberedTouch(ID),
    ];
    for (const key of keys) client.setQueryData(key, 'x');
    await client.invalidateQueries({ queryKey: queryKeys.root(ID) });
    const invalidated = keys.filter((key) => client.getQueryState(key)?.isInvalidated);
    expect(invalidated).toEqual([queryKeys.workspace(ID), queryKeys.link(ID)]);
  });

  it('remembered() and rememberedTouch(id) are the only keys outside the ws root', () => {
    expect(queryKeys.remembered()).toEqual(['remembered']);
    expect(queryKeys.rememberedTouch(ID)).toEqual(['remembered-touch', ID]);
    const outside = Object.entries(queryKeys)
      .filter(([name]) => name !== 'root')
      .filter(([, make]) => (make as (id: string) => readonly unknown[])(ID)[0] !== 'ws')
      .map(([name]) => name);
    expect(outside.sort()).toEqual(['remembered', 'rememberedTouch']);
  });
});
