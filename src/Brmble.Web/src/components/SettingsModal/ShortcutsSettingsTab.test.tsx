import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsSettingsTab, type ShortcutsSettings } from './ShortcutsSettingsTab';

const { bridgeMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
  },
}));

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

const baseSettings: ShortcutsSettings = {
  toggleMuteKey: null,
  toggleMuteDeafenKey: null,
  toggleLeaveVoiceKey: null,
  toggleDMScreenKey: null,
  toggleScreenShareKey: null,
  toggleGameKey: null,
};

describe('ShortcutsSettingsTab', () => {
  it('allows clearing an existing shortcut binding', () => {
    const onClearBinding = vi.fn();
    render(
      <ShortcutsSettingsTab
        settings={{ ...baseSettings, toggleMuteKey: 'KeyM' }}
        onChange={vi.fn()}
        allBindings={{ toggleMuteKey: 'KeyM' }}
        onClearBinding={onClearBinding}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear Toggle Mute binding' }));

    expect(onClearBinding).toHaveBeenCalledWith('toggleMuteKey');
  });

  it('places clear before a highlighted bound shortcut key', () => {
    render(
      <ShortcutsSettingsTab
        settings={{ ...baseSettings, toggleMuteKey: 'KeyM' }}
        onChange={vi.fn()}
        allBindings={{ toggleMuteKey: 'KeyM' }}
        onClearBinding={vi.fn()}
      />
    );

    const clearButton = screen.getByRole('button', { name: 'Clear Toggle Mute binding' });
    const keyButton = screen.getByRole('button', { name: 'KeyM' });

    expect(clearButton.compareDocumentPosition(keyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(keyButton).toHaveClass('btn-primary');
    expect(keyButton).not.toHaveClass('btn-secondary');
  });

  it('hides clear controls for shortcuts that are already empty', () => {
    render(
      <ShortcutsSettingsTab
        settings={baseSettings}
        onChange={vi.fn()}
        allBindings={{}}
        onClearBinding={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Clear Toggle Mute binding' })).not.toBeInTheDocument();
  });

  it('captures recorded keys without allowing app shortcut listeners to handle them', () => {
    const appShortcutListener = vi.fn();
    window.addEventListener('keydown', appShortcutListener);

    try {
      render(
        <ShortcutsSettingsTab
          settings={baseSettings}
          onChange={vi.fn()}
          allBindings={{}}
          onClearBinding={vi.fn()}
        />
      );

      fireEvent.click(screen.getAllByRole('button', { name: 'Not bound' })[0]);
      fireEvent.keyDown(window, { code: 'KeyM' });

      expect(appShortcutListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', appShortcutListener);
    }
  });

  it('keeps hotkeys suspended until the recorded keyboard input is released', () => {
    render(
      <ShortcutsSettingsTab
        settings={baseSettings}
        onChange={vi.fn()}
        allBindings={{}}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Not bound' })[0]);
    fireEvent.keyDown(window, { code: 'KeyM' });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.suspendHotkeys');
    expect(bridgeMock.send).not.toHaveBeenCalledWith('voice.resumeHotkeys');

    fireEvent.keyUp(window, { code: 'KeyM' });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.resumeHotkeys');
  });
});
