import { useState, useEffect, useCallback } from 'react';
import bridge from '../bridge';

export interface ChannelPermissions {
  channelId: number;
  permissions: number;
}

export const Permission = {
  Write: 0x1,
  Traverse: 0x2,
  Enter: 0x4,
  Speak: 0x8,
  MuteDeafen: 0x10,
  Move: 0x20,
  MakeChannel: 0x40,
  LinkChannel: 0x80,
  Whisper: 0x100,
  TextMessage: 0x200,
  MakeTempChannel: 0x400,
  Kick: 0x10000,
  Ban: 0x20000,
  Register: 0x40000,
  SelfRegister: 0x80000,
} as const;

export function usePermissions() {
  const [permissions, setPermissions] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    const handlePermissions = (data: unknown) => {
      const p = data as { channelId: number; permissions: number } | undefined;
      if (p?.channelId !== undefined && p?.permissions !== undefined) {
        setPermissions(prev => {
          const next = new Map(prev);
          next.set(p.channelId, p.permissions);
          return next;
        });
      }
    };

    bridge.on('voice.permissions', handlePermissions);

    return () => {
      bridge.off('voice.permissions', handlePermissions);
    };
  }, []);

  const requestPermissions = useCallback((channelId: number) => {
    bridge.send('voice.requestPermissions', { channelId });
  }, []);

  const getChannelPermissions = useCallback((channelId: number): number => {
    return permissions.get(channelId) ?? 0;
  }, [permissions]);

  const hasPermission = useCallback((channelId: number, permission: number): boolean => {
    return (getChannelPermissions(channelId) & permission) !== 0;
  }, [getChannelPermissions]);

  return {
    permissions,
    requestPermissions,
    getChannelPermissions,
    hasPermission,
    Permission,
  };
}
