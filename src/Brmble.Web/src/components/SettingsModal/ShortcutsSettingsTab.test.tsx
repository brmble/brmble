import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsSettingsTab, type ShortcutsSettings } from './ShortcutsSettingsTab';

const { bridgeMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
  },
}));

const { confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
}));

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

vi.mock('../../hooks/usePrompt', () => ({
  confirm: confirmMock,
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
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(false);
  });

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

  it('shows a newly recorded shortcut key immediately after successful capture', () => {
    const onChange = vi.fn();

    render(
      <ShortcutsSettingsTab
        settings={baseSettings}
        onChange={onChange}
        allBindings={{}}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Not bound' })[0]);
    fireEvent.keyDown(window, { code: 'KeyM' });

    expect(screen.getByRole('button', { name: 'KeyM' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Press any key...' })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ toggleLeaveVoiceKey: 'KeyM' }));
  });

  it('keeps showing the captured key when parent settings rerender before key release', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ShortcutsSettingsTab
        settings={baseSettings}
        onChange={onChange}
        allBindings={{}}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Not bound' })[0]);
    fireEvent.keyDown(window, { code: 'KeyM' });
    rerender(
      <ShortcutsSettingsTab
        settings={{ ...baseSettings, toggleLeaveVoiceKey: 'KeyM' }}
        onChange={onChange}
        allBindings={{ toggleLeaveVoiceKey: 'KeyM' }}
        onClearBinding={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'KeyM' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Press any key...' })).not.toBeInTheDocument();
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

  it('resumes hotkeys if unmounted while the recorded key is still held', () => {
    const { unmount } = render(
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
    bridgeMock.send.mockClear();

    unmount();

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.resumeHotkeys');
  });

  it('shows the rebound shortcut key immediately after confirming a conflict', async () => {
    confirmMock.mockResolvedValue(true);
    const onChange = vi.fn();

    render(
      <ShortcutsSettingsTab
        settings={baseSettings}
        onChange={onChange}
        allBindings={{ toggleMuteKey: 'KeyM' }}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Not bound' })[0]);
    fireEvent.keyDown(window, { code: 'KeyM' });

    expect(await screen.findByRole('button', { name: 'KeyM' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Press any key...' })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ toggleLeaveVoiceKey: 'KeyM' }));
  });

  it('returns to the previous shortcut key immediately after canceling a conflict', async () => {
    confirmMock.mockResolvedValue(false);
    const onChange = vi.fn();

    render(
      <ShortcutsSettingsTab
        settings={{ ...baseSettings, toggleLeaveVoiceKey: 'KeyV' }}
        onChange={onChange}
        allBindings={{ toggleLeaveVoiceKey: 'KeyV', toggleMuteKey: 'KeyM' }}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'KeyV' }));
    fireEvent.keyDown(window, { code: 'KeyM' });

    expect(await screen.findByRole('button', { name: 'KeyV' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Press any key...' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ toggleLeaveVoiceKey: 'KeyM' }));
  });
});
