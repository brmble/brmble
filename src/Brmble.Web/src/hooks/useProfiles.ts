import { useState, useEffect, useCallback } from 'react';
import bridge from '../bridge';

export interface Profile {
  id: string;
  name: string;
  fingerprint: string | null;
  certValid: boolean;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onList = (data: unknown) => {
      const d = data as { profiles: Profile[]; activeProfileId: string | null };
      setProfiles(d.profiles ?? []);
      setActiveProfileId(d.activeProfileId ?? null);
      setLoading(false);
    };

    const onAdded = (data: unknown) => {
      const d = data as Profile;
      setProfiles(prev => [...prev, d]);
    };

    const onRemoved = (data: unknown) => {
      const d = data as { id: string };
      setProfiles(prev => prev.filter(p => p.id !== d.id));
    };

    const onRenamed = (data: unknown) => {
      const d = data as { id: string; name: string; fingerprint?: string | null; certValid?: boolean };
      setProfiles(prev => prev.map(p => p.id === d.id ? {
        ...p,
        name: d.name,
        ...(d.fingerprint !== undefined ? { fingerprint: d.fingerprint } : {}),
        ...(d.certValid !== undefined ? { certValid: d.certValid } : {}),
      } : p));
    };

    const onActiveChanged = (data: unknown) => {
      const d = data as { id: string | null; name: string | null; fingerprint: string | null };
      setActiveProfileId(d.id);
    };

    bridge.on('profiles.list', onList);
    bridge.on('profiles.added', onAdded);
    bridge.on('profiles.removed', onRemoved);
    bridge.on('profiles.renamed', onRenamed);
    bridge.on('profiles.activeChanged', onActiveChanged);
    bridge.send('profiles.list');

    return () => {
      bridge.off('profiles.list', onList);
      bridge.off('profiles.added', onAdded);
      bridge.off('profiles.removed', onRemoved);
      bridge.off('profiles.renamed', onRenamed);
      bridge.off('profiles.activeChanged', onActiveChanged);
    };
  }, []);

  const addProfile = useCallback((name: string) => {
    bridge.send('profiles.add', { name });
  }, []);

  const importProfile = useCallback((name: string, data: string) => {
    bridge.send('profiles.import', { name, data });
  }, []);

  const removeProfile = useCallback((id: string) => {
    bridge.send('profiles.remove', { id });
  }, []);

  const renameProfile = useCallback((id: string, name: string) => {
    bridge.send('profiles.rename', { id, name });
  }, []);

  const setActive = useCallback((id: string) => {
    bridge.send('profiles.setActive', { id });
  }, []);

  const exportCert = useCallback(() => {
    bridge.send('cert.export');
  }, []);

  const checkExistingCert = useCallback((name: string): Promise<{ exists: boolean; fingerprint: string | null }> => {
    return new Promise((resolve) => {
      const handler = (data: unknown) => {
        bridge.off('profiles.checkCertResult', handler);
        const d = data as { exists: boolean; fingerprint?: string | null };
        resolve({ exists: d.exists, fingerprint: d.fingerprint ?? null });
      };
      bridge.on('profiles.checkCertResult', handler);
      bridge.send('profiles.checkCert', { name });
    });
  }, []);

  const addFromExisting = useCallback((name: string) => {
    bridge.send('profiles.addFromExisting', { name });
  }, []);

  const renameSwapCert = useCallback((id: string, name: string) => {
    bridge.send('profiles.renameSwapCert', { id, name });
  }, []);

  return { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert, checkExistingCert, addFromExisting, renameSwapCert };
}
