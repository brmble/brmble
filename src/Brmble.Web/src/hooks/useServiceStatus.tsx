import { createContext, useContext, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { ServiceName, ServiceStatus, ServiceStatusMap } from '../types';

const DEFAULT_STATUSES: ServiceStatusMap = {
  voice: { state: 'disconnected' },
  chat: { state: 'unavailable' },
  server: { state: 'unavailable' },
  livekit: { state: 'unavailable' },
};

interface ServiceStatusContextValue {
  statuses: ServiceStatusMap;
  updateStatus: (service: ServiceName, update: Partial<ServiceStatus>) => void;
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

  return (
    <ServiceStatusContext.Provider value={{ statuses, updateStatus }}>
      {children}
    </ServiceStatusContext.Provider>
  );
}

export function useServiceStatus() {
  const ctx = useContext(ServiceStatusContext);
  if (!ctx) throw new Error('useServiceStatus must be used within ServiceStatusProvider');
  return ctx;
}
