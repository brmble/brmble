import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from './conversation';
import {
  conversationStorageKey,
  loadConversationTabs,
  saveConversationTabs,
} from './conversationStorage';

const channel = (id: string): Conversation => ({ kind: 'channel', channelId: id });
const dm = (id: string): Conversation => ({ kind: 'dm', contactId: id });
const always = () => true;

describe('conversation tab persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips tabs for a server', () => {
    saveConversationTabs('server-a', [channel('9'), dm('@val:example.com')]);
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9'), dm('@val:example.com')]);
  });

  it('scopes storage per server', () => {
    saveConversationTabs('server-a', [channel('9')]);
    saveConversationTabs('server-b', [channel('4')]);
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9')]);
    expect(loadConversationTabs('server-b', always)).toEqual([channel('4')]);
    expect(conversationStorageKey('server-a')).not.toBe(conversationStorageKey('server-b'));
  });

  it('returns an empty list when nothing is stored', () => {
    expect(loadConversationTabs('server-a', always)).toEqual([]);
  });

  it('drops conversations the validator rejects', () => {
    saveConversationTabs('server-a', [channel('9'), channel('404'), dm('gone')]);
    const restored = loadConversationTabs('server-a', c =>
      c.kind === 'channel' ? c.channelId === '9' : false);
    expect(restored).toEqual([channel('9')]);
  });

  it('resets to empty on malformed json', () => {
    localStorage.setItem(conversationStorageKey('server-a'), '{not json');
    expect(loadConversationTabs('server-a', always)).toEqual([]);
  });

  it('resets to empty on an unexpected version', () => {
    localStorage.setItem(conversationStorageKey('server-a'), JSON.stringify({ version: 99, tabs: [channel('9')] }));
    expect(loadConversationTabs('server-a', always)).toEqual([]);
  });

  it('discards structurally invalid entries without discarding valid ones', () => {
    localStorage.setItem(conversationStorageKey('server-a'), JSON.stringify({
      version: 1,
      tabs: [channel('9'), { kind: 'channel' }, { kind: 'wormhole', id: 1 }, null, dm('a')],
    }));
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9'), dm('a')]);
  });

  it('deduplicates repeated keys', () => {
    saveConversationTabs('server-a', [channel('9'), channel('9'), dm('a')]);
    expect(loadConversationTabs('server-a', always)).toEqual([channel('9'), dm('a')]);
  });

  it('survives a storage write failure without throwing', () => {
    // Patch the prototype of the *live* localStorage object. Under jsdom that is
    // Storage.prototype; under the Map-backed shim in test-setup.ts (Node 25 path) it is
    // StorageShim.prototype. Patching Storage.prototype unconditionally, or spying on the
    // localStorage object itself, silently fails in one of the two environments and would
    // make this test pass vacuously. toHaveBeenCalled() proves the throw was reached.
    const setItem = vi
      .spyOn(Object.getPrototypeOf(localStorage) as Storage, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    try {
      expect(() => saveConversationTabs('server-a', [channel('9')])).not.toThrow();
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });
});
