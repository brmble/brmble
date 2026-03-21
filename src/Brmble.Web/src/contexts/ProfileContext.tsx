import { createContext, useContext } from 'react';

const ProfileContext = createContext<string>('');

export const ProfileProvider = ProfileContext.Provider;

export function useProfileFingerprint(): string {
  return useContext(ProfileContext);
}
