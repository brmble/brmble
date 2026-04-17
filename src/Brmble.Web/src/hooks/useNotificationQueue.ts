import { useState, useCallback, useRef } from 'react';
import type { NotificationStatus } from '../components/Notification/Notification';

const MAX_VISIBLE = 3;

const PRIORITY: Record<NotificationStatus, number> = {
  error: 3,
  warning: 2,
  info: 1,
  success: 0,
};

export interface QueueEntry {
  id: string;
  status: NotificationStatus;
  /** Arrival order for stable sorting within same priority */
  _order: number;
}

/**
 * Manages which top-right notifications are visible (max 3).
 * Higher-priority notifications preempt lower-priority ones.
 * Displaced notifications re-appear when a slot opens.
 *
 * Usage:
 *   const q = useNotificationQueue();
 *   q.register('broken-cert-1', 'warning');  // register when data exists
 *   q.unregister('broken-cert-1');            // unregister when dismissed/exited
 *   const isVisible = q.isVisible('broken-cert-1');
 */
export function useNotificationQueue() {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const orderRef = useRef(0);

  const getVisible = useCallback((items: QueueEntry[]): Set<string> => {
    const sorted = [...items].sort((a, b) => {
      const pDiff = PRIORITY[b.status] - PRIORITY[a.status];
      if (pDiff !== 0) return pDiff;
      return a._order - b._order;
    });
    const visibleIds = new Set<string>();
    for (let i = 0; i < Math.min(MAX_VISIBLE, sorted.length); i++) {
      visibleIds.add(sorted[i].id);
    }
    return visibleIds;
  }, []);

  const register = useCallback((id: string, status: NotificationStatus) => {
    setEntries(prev => {
      if (prev.some(e => e.id === id)) return prev;
      return [...prev, { id, status, _order: orderRef.current++ }];
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  const visibleSet = getVisible(entries);

  const isVisible = useCallback((id: string) => visibleSet.has(id), [visibleSet]);

  return { register, unregister, isVisible, visibleCount: visibleSet.size, totalCount: entries.length };
}
