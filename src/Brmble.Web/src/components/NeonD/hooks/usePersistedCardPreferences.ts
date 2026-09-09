import { useCallback, useMemo, useState } from 'react';

export const NEON_D_CARD_PREFERENCES_KEY = 'brmble_neon_d_card_preferences_v1';

type CardPreferences = {
  collapsedSellerIds: string[];
};

const readCollapsedSellerIds = (knownSellerIds: ReadonlySet<string>): Set<string> => {
  try {
    const stored = localStorage.getItem(NEON_D_CARD_PREFERENCES_KEY);
    if (!stored) return new Set();

    const parsed = JSON.parse(stored) as Partial<CardPreferences>;
    if (!Array.isArray(parsed.collapsedSellerIds)) return new Set();

    return new Set(
      parsed.collapsedSellerIds.filter(
        (sellerId): sellerId is string => typeof sellerId === 'string' && knownSellerIds.has(sellerId),
      ),
    );
  } catch {
    return new Set();
  }
};

const saveCollapsedSellerIds = (collapsedSellerIds: ReadonlySet<string>) => {
  try {
    const preferences: CardPreferences = {
      collapsedSellerIds: [...collapsedSellerIds],
    };
    localStorage.setItem(NEON_D_CARD_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are best effort and must not affect the game UI.
  }
};

export function usePersistedCardPreferences(
  knownSellerIds: readonly string[],
): [ReadonlySet<string>, (sellerId: string) => void, () => void] {
  const knownSellerIdSet = useMemo(() => new Set(knownSellerIds), [knownSellerIds]);
  const [collapsedSellerIds, setCollapsedSellerIds] = useState<Set<string>>(() =>
    readCollapsedSellerIds(knownSellerIdSet),
  );

  const toggleSellerCard = useCallback((sellerId: string) => {
    if (!knownSellerIdSet.has(sellerId)) return;

    setCollapsedSellerIds((current) => {
      const next = new Set(current);
      if (next.has(sellerId)) next.delete(sellerId);
      else next.add(sellerId);
      saveCollapsedSellerIds(next);
      return next;
    });
  }, [knownSellerIdSet]);

  const clearPreferences = useCallback(() => {
    try {
      localStorage.removeItem(NEON_D_CARD_PREFERENCES_KEY);
    } catch {
      // Preferences are best effort and must not affect the game UI.
    }
  }, []);

  return [collapsedSellerIds, toggleSellerCard, clearPreferences];
}
