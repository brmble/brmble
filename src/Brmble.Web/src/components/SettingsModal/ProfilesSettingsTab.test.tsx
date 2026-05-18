import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfilesSettingsTab } from './ProfilesSettingsTab';

const { useProfilesMock } = vi.hoisted(() => ({
  useProfilesMock: vi.fn(),
}));

vi.mock('../../hooks/useProfiles', () => ({
  useProfiles: useProfilesMock,
}));

describe('ProfilesSettingsTab', () => {
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
    });

    const { container } = render(<ProfilesSettingsTab connected={false} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete .* profile/i });
    expect(deleteButtons).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Delete profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Bramble profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Thorn profile' })).toBeInTheDocument();

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
