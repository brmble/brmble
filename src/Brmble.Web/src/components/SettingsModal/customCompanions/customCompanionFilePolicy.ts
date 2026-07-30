export type SupportedCompanionMime = 'image/png' | 'image/webp';

export function getSupportedCompanionMime(file: File): SupportedCompanionMime | null {
  const lowerName = file.name.toLowerCase();
  const expected = lowerName.endsWith('.png')
    ? 'image/png'
    : lowerName.endsWith('.webp')
      ? 'image/webp'
      : null;
  if (!expected) return null;

  const reported = file.type.trim().toLowerCase();
  return reported === '' || reported === expected ? expected : null;
}
