import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InterfaceSettingsTab } from '../SettingsModal/InterfaceSettingsTab';
import { DEFAULT_APPEARANCE, DEFAULT_BRMBLEGOTCHI, DEFAULT_OVERLAY } from '../SettingsModal/InterfaceSettingsTypes';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

describe('InterfaceSettingsTab overlay controls', () => {
  it('renders overlay mode and event toggles and forwards changes', () => {
    const onOverlayChange = vi.fn();

    render(
      <InterfaceSettingsTab
        appearanceSettings={DEFAULT_APPEARANCE}
        overlaySettings={{ ...DEFAULT_OVERLAY, mode: 'full' }}
        brmblegotchiSettings={DEFAULT_BRMBLEGOTCHI}
        onAppearanceChange={vi.fn()}
        onOverlayChange={onOverlayChange}
        onBrmblegotchiChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Enable Companion Overlay'));
    fireEvent.click(screen.getByText('My Companion').closest('.settings-item')!.querySelector('[role="combobox"]')!);
    fireEvent.click(screen.getByRole('option', { name: 'Bee' }));
    fireEvent.click(screen.getAllByRole('combobox')[3]);
    fireEvent.click(screen.getByRole('option', { name: 'Top Left' }));
    fireEvent.click(screen.getByLabelText('Show Direct Messages'));

    expect(onOverlayChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      overlayEnabled: true,
    }));
    expect(onOverlayChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      myCompanion: 'bee',
    }));
    expect(onOverlayChange).toHaveBeenNthCalledWith(3, expect.objectContaining({
      position: 'top-left',
    }));
    expect(onOverlayChange).toHaveBeenNthCalledWith(4, expect.objectContaining({
      showDirectMessages: false,
    }));
  });
});
