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
    expect(screen.getByText('Hide optional pop-up notifications. Critical warnings and one-time account or update notices may still appear.')).toBeInTheDocument();
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
    expect(screen.getByLabelText('Idle reminders')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Disable optional notifications'));

    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      notificationsDisabled: false,
    });
  });
});
