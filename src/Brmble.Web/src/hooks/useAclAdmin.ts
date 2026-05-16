import { useEffect, useState } from 'react';
import bridge from '../bridge';
import type { AclChannelSnapshot, AclUpdateRequest } from '../types/acl';

interface BridgeResponse {
  channelId?: number;
  body?: string;
  error?: string;
  statusCode?: number;
  snapshot?: AclChannelSnapshot;
}

interface AclWritePayload {
  snapshot?: AclChannelSnapshot;
  warning?: string | null;
  error?: string | null;
}

export function useAclAdmin(channelId: number | null) {
  const [snapshot, setSnapshot] = useState<AclChannelSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleChannel = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId || !payload.body) return;
      const parsed = JSON.parse(payload.body) as { snapshot: AclChannelSnapshot };
      setSnapshot(parsed.snapshot);
      setLoading(false);
      setError(null);
    };
    const handleChanged = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId || !payload.snapshot) return;
      setSnapshot(payload.snapshot);
      setError(null);
    };
    const handleError = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId) return;
      if (payload.statusCode === 409 && payload.body) {
        const parsed = JSON.parse(payload.body) as AclWritePayload;
        if (parsed.snapshot) setSnapshot(parsed.snapshot);
        setError(parsed.error ?? parsed.warning ?? payload.error ?? 'ACL changed since it was opened.');
        setLoading(false);
        setSaving(false);
        return;
      }

      setError(payload.error ?? `ACL request failed with status ${payload.statusCode ?? 'unknown'}`);
      setLoading(false);
      setSaving(false);
    };
    const handleWriteResult = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId || !payload.body) return;
      const parsed = JSON.parse(payload.body) as AclWritePayload;
      if (parsed.snapshot) setSnapshot(parsed.snapshot);
      setError(parsed.error ?? parsed.warning ?? null);
      setLoading(false);
      setSaving(false);
    };

    bridge.on('acl.channel', handleChannel);
    bridge.on('acl.changed', handleChanged);
    bridge.on('acl.error', handleError);
    bridge.on('acl.writeResult', handleWriteResult);
    return () => {
      bridge.off('acl.channel', handleChannel);
      bridge.off('acl.changed', handleChanged);
      bridge.off('acl.error', handleError);
      bridge.off('acl.writeResult', handleWriteResult);
    };
  }, [channelId]);

  const refresh = () => {
    if (channelId == null) return;
    setLoading(true);
    setError(null);
    bridge.send('acl.getChannel', { channelId });
  };

  const save = (request: Omit<AclUpdateRequest, 'expectedSnapshotHash'>) => {
    if (channelId == null || !snapshot?.snapshotHash) return;
    setSaving(true);
    setError(null);
    bridge.send('acl.setChannel', {
      channelId,
      request: {
        ...request,
        groups: request.groups.filter(group => !group.inherited),
        acls: request.acls.filter(rule => !rule.inherited),
        expectedSnapshotHash: snapshot.snapshotHash,
      },
    });
  };

  const savePassword = (password: string) => {
    if (channelId == null) return;
    setSaving(true);
    setError(null);
    bridge.send('acl.setChannelPassword', { channelId, password });
  };

  const addGroupMember = (group: string, session: number) => {
    if (channelId == null) return;
    setSaving(true);
    setError(null);
    bridge.send('acl.addGroupMember', { channelId, group, session });
  };

  const removeGroupMember = (group: string, session: number) => {
    if (channelId == null) return;
    setSaving(true);
    setError(null);
    bridge.send('acl.removeGroupMember', { channelId, group, session });
  };

  return { snapshot, loading, saving, error, refresh, save, savePassword, addGroupMember, removeGroupMember };
}
