import type { ConnectionStatus } from '../../types';
import { BrmbleLogo } from '../Header/BrmbleLogo';
import './ConnectionState.css';

interface ConnectionStateProps {
  connectionStatus: ConnectionStatus;
  serverLabel?: string;
  errorMessage?: string;
  onCancel?: () => void;
  onReconnect?: () => void;
  onBackToServerList?: () => void;
}

export function ConnectionState({
  connectionStatus,
  serverLabel,
  errorMessage,
  onCancel,
  onReconnect,
  onBackToServerList,
}: ConnectionStateProps) {
  const isAnimated = connectionStatus === 'connecting' || connectionStatus === 'reconnecting';

  const heading: Partial<Record<ConnectionStatus, string>> = {
    connecting: 'Connecting...',
    reconnecting: 'Reconnecting...',
    disconnected: 'Connection Lost',
    failed: 'Connection Failed',
  };

  const subtext: Partial<Record<ConnectionStatus, string>> = {
    connecting: `Reaching ${serverLabel || 'server'}...`,
    reconnecting: `Trying to reach ${serverLabel || 'server'}...`,
    disconnected: `You were disconnected from ${serverLabel || 'the server'}`,
    failed: `Could not reconnect to ${serverLabel || 'the server'}`,
  };

  return (
    <div className="connection-state" role="status" aria-live="polite">
      <div className="connection-state-content">
        <div className="connection-state-logo">
          <BrmbleLogo size={192} heartbeat={isAnimated} />
        </div>
        <h2 className="heading-title">{heading[connectionStatus] ?? connectionStatus}</h2>
        <p className="connection-state-subtext">{subtext[connectionStatus] ?? ''}</p>
        {errorMessage && (
          <p className="connection-state-error">{errorMessage}</p>
        )}
        <div className="connection-state-actions">
          {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && onCancel && (
            <button className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          {connectionStatus === 'disconnected' && (
            <>
              {onReconnect && (
                <button className="btn btn-primary" onClick={onReconnect}>
                  Reconnect
                </button>
              )}
              {onBackToServerList && (
                <button className="btn btn-secondary" onClick={onBackToServerList}>
                  Back to Server List
                </button>
              )}
            </>
          )}
          {connectionStatus === 'failed' && onBackToServerList && (
            <button className="btn btn-primary" onClick={onBackToServerList}>
              Back to Server List
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
