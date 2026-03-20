import { createContext, useContext, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { ServiceName, ServiceStatus, ServiceStatusMap } from '../types';

const DEFAULT_STATUSES: ServiceStatusMap = {
  voice: { state: 'idle' },
  chat: { state: 'idle' },
  server: { state: 'idle' },
  livekit: { state: 'idle' },
};

interface ServiceStatusContextValue {
  statuses: ServiceStatusMap;
  updateStatus: (service: ServiceName, update: Partial<ServiceStatus>) => void;
  resetStatuses: () => void;
}

const ServiceStatusContext = createContext<ServiceStatusContextValue | null>(null);

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<ServiceStatusMap>(DEFAULT_STATUSES);

  const updateStatus = useCallback((service: ServiceName, update: Partial<ServiceStatus>) => {
    setStatuses(prev => ({
      ...prev,
      [service]: { ...prev[service], ...update },
    }));
  }, []);

  const resetStatuses = useCallback(() => {
    setStatuses(DEFAULT_STATUSES);
  }, []);

  return (
    <ServiceStatusContext.Provider value={{ statuses, updateStatus, resetStatuses }}>
      {children}
    </ServiceStatusContext.Provider>
  );
}

export function useServiceStatus() {
  const ctx = useContext(ServiceStatusContext);
  if (!ctx) throw new Error('useServiceStatus must be used within ServiceStatusProvider');
  return ctx;
}
