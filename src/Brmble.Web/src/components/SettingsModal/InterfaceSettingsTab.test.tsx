import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InterfaceSettingsTab } from './InterfaceSettingsTab';
import { DEFAULT_OVERLAY } from './InterfaceSettingsTypes';

describe('InterfaceSettingsTab', () => {
  it('does not render plain inline overlay help text', () => {
    render(
      <InterfaceSettingsTab
        appearanceSettings={{ theme: 'classic' }}
        overlaySettings={DEFAULT_OVERLAY}
        brmblegotchiSettings={{ enabled: true }}
        onAppearanceChange={vi.fn()}
        onOverlayChange={vi.fn()}
        onBrmblegotchiChange={vi.fn()}
      />
    );

    expect(screen.queryByText(/Keep a small Brmblegotchi companion overlay/)).not.toBeInTheDocument();
  });
});
