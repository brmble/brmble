import { useCallback, useEffect, useState } from 'react';
import bridge from '../../../bridge';
import type { Channel } from '../../../types';
import type { AclChannelSnapshot, AclGroup, AclRule } from '../../../types/acl';

interface BridgeResponse {
  channelId?: number;
  body?: string;
  error?: string;
}

interface CatalogState {
  groups: AclGroup[];
  acls: AclRule[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function mergeGroups(snapshots: AclChannelSnapshot[]): AclGroup[] {
  const groupsByName = new Map<string, AclGroup>();

  snapshots.forEach(snapshot => {
    snapshot.groups.forEach(group => {
      const existing = groupsByName.get(group.name);
      if (!existing) {
        groupsByName.set(group.name, {
          ...group,
          add: [...group.add],
          remove: [...group.remove],
          members: [...group.members],
        });
        return;
      }

      groupsByName.set(group.name, {
        name: group.name,
        inherited: existing.inherited && group.inherited,
        inherit: existing.inherit || group.inherit,
        inheritable: existing.inheritable || group.inheritable,
        add: [...new Set([...existing.add, ...group.add])].sort((left, right) => left - right),
        remove: [...new Set([...existing.remove, ...group.remove])].sort((left, right) => left - right),
        members: [...new Set([...existing.members, ...group.members])].sort((left, right) => left - right),
      });
    });
  });

  return [...groupsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function mergeAcls(snapshots: AclChannelSnapshot[]): AclRule[] {
  return snapshots.flatMap(snapshot => snapshot.acls);
}

export function useAdminGroupCatalog(channels: Channel[]): CatalogState {
  const [groups, setGroups] = useState<AclGroup[]>([]);
  const [acls, setAcls] = useState<AclRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken(current => current + 1);
  }, []);

  useEffect(() => {
    if (channels.length === 0) {
      setGroups([]);
      setAcls([]);
      setLoading(false);
      setError(null);
      return;
    }

    const pendingChannelIds = new Set(channels.map(channel => channel.id));
    const snapshots = new Map<number, AclChannelSnapshot>();
    const failures: string[] = [];

    setLoading(true);
    setError(null);

    const handleChannel = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (typeof payload.channelId !== 'number' || !pendingChannelIds.has(payload.channelId) || !payload.body) return;

      const parsed = JSON.parse(payload.body) as { snapshot: AclChannelSnapshot };
      snapshots.set(payload.channelId, parsed.snapshot);
      pendingChannelIds.delete(payload.channelId);

      if (pendingChannelIds.size === 0) {
        const resolvedSnapshots = [...snapshots.values()];
        setGroups(mergeGroups(resolvedSnapshots));
        setAcls(mergeAcls(resolvedSnapshots));
        setLoading(false);
        setError(resolvedSnapshots.length === 0 && failures.length > 0 ? failures[0] : null);
      }
    };

    const handleError = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (typeof payload.channelId !== 'number' || !pendingChannelIds.has(payload.channelId)) return;

      failures.push(payload.error ?? `ACL request failed for channel ${payload.channelId}.`);
      pendingChannelIds.delete(payload.channelId);

      if (pendingChannelIds.size === 0) {
        const resolvedSnapshots = [...snapshots.values()];
        setGroups(mergeGroups(resolvedSnapshots));
        setAcls(mergeAcls(resolvedSnapshots));
        setLoading(false);
        setError(resolvedSnapshots.length === 0 && failures.length > 0 ? failures[0] : null);
      }
    };

    bridge.on('acl.channel', handleChannel);
    bridge.on('acl.error', handleError);

    channels.forEach(channel => {
      bridge.send('acl.getChannel', { channelId: channel.id });
    });

    return () => {
      bridge.off('acl.channel', handleChannel);
      bridge.off('acl.error', handleError);
    };
  }, [channels, refreshToken]);

  return { groups, acls, loading, error, refresh };
}
