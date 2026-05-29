import { useState } from 'react';
import { ChannelRequestHttpError, createChannelRequest } from '../../api/channelRequests';
import './RequestChannelModal.css';

interface RequestChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function RequestChannelModal({ isOpen, onClose, onCreated }: RequestChannelModalProps) {
  const [channelName, setChannelName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const submit = async () => {
    if (!channelName.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await createChannelRequest({ channelName: channelName.trim(), reason });
      setChannelName('');
      setReason('');
      onCreated();
    } catch (err) {
      if (err instanceof ChannelRequestHttpError) {
        setError(err.message);
      } else {
        setError('Could not send the request. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="request-channel-modal glass-panel animate-slide-up" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Request a voice channel</h2>
          <p className="modal-subtitle">Ask an admin to create a new Mumble voice channel.</p>
        </div>
        <div className="request-channel-form">
          <label className="request-channel-field">
            <span>Channel name</span>
            <input
              className="brmble-input"
              value={channelName}
              maxLength={50}
              onChange={event => setChannelName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void submit();
              }}
              autoFocus
            />
          </label>
          <label className="request-channel-field">
            <span>Reason</span>
            <textarea
              className="brmble-input request-channel-reason"
              value={reason}
              maxLength={400}
              onChange={event => setReason(event.target.value)}
              placeholder="Optional, but it helps admins understand the request."
            />
          </label>
          {error && <p className="request-channel-error" role="alert">{error}</p>}
        </div>
        <div className="prompt-footer">
          <span className="char-counter">{reason.length}/400</span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!channelName.trim() || submitting} onClick={() => void submit()}>
            {submitting ? 'Sending...' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  );
}
