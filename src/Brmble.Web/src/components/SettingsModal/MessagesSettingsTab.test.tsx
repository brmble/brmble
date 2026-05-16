import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MESSAGES, MessagesSettingsTab, type MessagesSettings } from './MessagesSettingsTab';

describe('MessagesSettingsTab optional notifications', () => {
  it('defaults optional notification suppression off and individual categories on', () => {
    render(<MessagesSettingsTab settings={DEFAULT_MESSAGES} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Disable optional notifications')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).toBeChecked();
    expect(screen.getByLabelText('Screen share status')).toBeChecked();
    expect(screen.getByLabelText('Idle reminders')).toBeChecked();
    expect(screen.getByLabelText('Channel move notices')).toBeChecked();
    expect(screen.queryByText('Hide optional pop-up notifications. Critical warnings and one-time account or update notices may still appear.')).not.toBeInTheDocument();
  });

  it('shows category toggles as off and disabled while preserving stored choices when global disable is on', () => {
    const onChange = vi.fn();
    const settings: MessagesSettings = {
      ...DEFAULT_MESSAGES,
      notificationIdleWarning: false,
    };

    const { rerender } = render(<MessagesSettingsTab settings={settings} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Disable optional notifications'));

    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      notificationsDisabled: true,
    });

    rerender(<MessagesSettingsTab settings={{ ...settings, notificationsDisabled: true }} onChange={onChange} />);

    expect(screen.getByLabelText('Screen share invitations')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share status')).not.toBeChecked();
    expect(screen.getByLabelText('Idle reminders')).not.toBeChecked();
    expect(screen.getByLabelText('Channel move notices')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).toBeDisabled();
    expect(screen.getByLabelText('Screen share status')).toBeDisabled();
    expect(screen.getByLabelText('Idle reminders')).toBeDisabled();
    expect(screen.getByLabelText('Channel move notices')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Disable optional notifications'));

    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      notificationsDisabled: false,
    });

    rerender(<MessagesSettingsTab settings={{ ...settings, notificationsDisabled: false }} onChange={onChange} />);

    expect(screen.getByLabelText('Screen share invitations')).toBeChecked();
    expect(screen.getByLabelText('Screen share status')).toBeChecked();
    expect(screen.getByLabelText('Idle reminders')).not.toBeChecked();
    expect(screen.getByLabelText('Channel move notices')).toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).not.toBeDisabled();
    expect(screen.getByLabelText('Idle reminders')).not.toBeDisabled();
  });

  it('maps legacy notificationsEnabled false to Disable optional notifications on', () => {
    const legacySettings = {
      ttsEnabled: false,
      ttsVolume: 100,
      ttsVoice: '',
      notificationsEnabled: false,
    } as unknown as MessagesSettings;

    render(<MessagesSettingsTab settings={legacySettings} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Disable optional notifications')).toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).toBeDisabled();
  });

  it('does not let legacy notificationsEnabled override explicit notificationsDisabled false', () => {
    render(<MessagesSettingsTab settings={{ ...DEFAULT_MESSAGES, notificationsEnabled: false, notificationsDisabled: false } as unknown as MessagesSettings} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Disable optional notifications')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).not.toBeDisabled();
  });

  it('preserves stored categories when legacy disabled settings are re-enabled', () => {
    const legacySettings = {
      ttsEnabled: false,
      ttsVolume: 100,
      ttsVoice: '',
      notificationsEnabled: false,
      notificationIdleWarning: false,
    } as unknown as MessagesSettings;

    const { rerender } = render(<MessagesSettingsTab settings={legacySettings} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Disable optional notifications')).toBeChecked();
    expect(screen.getByLabelText('Idle reminders')).not.toBeChecked();

    rerender(<MessagesSettingsTab settings={{ ...DEFAULT_MESSAGES, notificationIdleWarning: false, notificationsDisabled: false }} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Disable optional notifications')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).toBeChecked();
    expect(screen.getByLabelText('Screen share status')).toBeChecked();
    expect(screen.getByLabelText('Idle reminders')).not.toBeChecked();
    expect(screen.getByLabelText('Channel move notices')).toBeChecked();
  });
});
