import type { NativeBrmbleServiceStatus, ServiceName, ServiceStatus } from '../types';

export interface MappedBrmbleServiceStatus {
  service: ServiceName;
  update: Partial<ServiceStatus>;
}

function mapState(state: NativeBrmbleServiceStatus['state']): ServiceStatus['state'] {
  if (state === 'connected') return 'connected';
  if (state === 'connecting' || state === 'reconnecting') return 'connecting';
  if (state === 'disconnected') return 'disconnected';
  return 'idle';
}

export function mapBrmbleServiceStatus(data: NativeBrmbleServiceStatus): MappedBrmbleServiceStatus | null {
  if (!data.service || !data.state) return null;

  if (data.service === 'screenshare') {
    if (data.reason === 'active-share-request-failed' || data.reason === 'share-stopped-failed') {
      return {
        service: 'livekit',
        update: {
          state: 'connected',
          error: undefined,
        },
      };
    }

    return {
      service: 'livekit',
      update: {
        state: mapState(data.state),
        error: data.state === 'connected' ? undefined : data.reason,
      },
    };
  }

  if (data.service === 'session') {
    return {
      service: 'server',
      update: {
        state: mapState(data.state),
        error: data.state === 'connected' ? undefined : `Session ${data.state}: ${data.reason ?? 'reconnecting'}`,
      },
    };
  }

  return {
    service: 'server',
    update: {
      state: mapState(data.state),
      error: data.state === 'connected' ? undefined : data.reason,
    },
  };
}
