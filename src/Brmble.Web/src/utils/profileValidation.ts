/**
 * Profile name validation matching Mumble's default username charset
 * minus Windows-invalid filename characters (only '|' removed).
 *
 * Allowed: word chars (letters, digits, _), - = [ ] { } ( ) @ .
 * Disallowed: spaces, |, and all other special characters.
 * Max length: 128 characters.
 */
const VALID_PROFILE_NAME_REGEX = /^[-=\w[\]{}()@.]+$/;

const MAX_PROFILE_NAME_LENGTH = 128;

/**
 * Validates a profile name. Returns null if valid, or an error message string if invalid.
 */
export function validateProfileName(name: string | undefined | null): string | null {
  if (!name || name.trim().length === 0) {
    return 'Profile name cannot be empty.';
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_PROFILE_NAME_LENGTH) {
    return 'Profile name must be 128 characters or fewer.';
  }
  if (!VALID_PROFILE_NAME_REGEX.test(trimmed)) {
    return 'Only letters, numbers, and - = _ . [ ] { } ( ) @ are allowed.';
  }
  return null;
}

/**
 * Returns true if the trimmed name is a valid profile name.
 */
export function isValidProfileName(name: string): boolean {
  return validateProfileName(name) === null;
}

/**
 * Known generic / default CN names used by Mumble clients.
 * Extend this list as more defaults are discovered.
 */
const GENERIC_CN_NAMES = ['mumble user'];

/**
 * Returns true if the certificate CN is empty, blank, or a known generic default.
 */
export function isGenericCN(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  return GENERIC_CN_NAMES.includes(name.trim().toLowerCase());
}
