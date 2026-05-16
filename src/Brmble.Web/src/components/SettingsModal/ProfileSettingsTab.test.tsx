import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileSettingsTab } from './ProfileSettingsTab';

const { useProfilesMock, bridgeMock } = vi.hoisted(() => ({
  useProfilesMock: vi.fn(),
  bridgeMock: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../../hooks/useProfiles', () => ({
  useProfiles: useProfilesMock,
}));

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

describe('ProfileSettingsTab', () => {
  it('renders profile delete buttons with the shared icon and stagger index token', () => {
    useProfilesMock.mockReturnValue({
      profiles: [
        { id: 'profile-1', name: 'Bramble', fingerprint: 'abcdef', certValid: true },
        { id: 'profile-2', name: 'Thorn', fingerprint: '123456', certValid: true },
      ],
      activeProfileId: 'profile-1',
      loading: false,
      addProfile: vi.fn(),
      importProfile: vi.fn(),
      removeProfile: vi.fn(),
      renameProfile: vi.fn(),
      setActive: vi.fn(),
      exportCert: vi.fn(),
      checkExistingCert: vi.fn(),
      addFromExisting: vi.fn(),
      renameSwapCert: vi.fn(),
      recoverProfile: vi.fn(),
    });

    const { container } = render(
      <ProfileSettingsTab
        currentUser={{ name: 'Bramble' }}
        onUploadAvatar={vi.fn()}
        onRemoveAvatar={vi.fn()}
        connected={false}
      />
    );

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete profile' });
    expect(deleteButtons).toHaveLength(2);

    for (const button of deleteButtons) {
      expect(button).not.toHaveTextContent('✕');
      expect(button.querySelector('svg')).toBeInTheDocument();
    }

    const profileItems = container.querySelectorAll<HTMLElement>('.profiles-item');
    expect(profileItems[0]).toHaveStyle({ '--stagger-index': '0' });
    expect(profileItems[1]).toHaveStyle({ '--stagger-index': '1' });
    expect(profileItems[1].style.animationDelay).toBe('');
  });
});
