import bridge from '../bridge';

interface ChannelPasswordResponse {
  requestId?: string;
  channelId?: number;
  password?: string;
}

export function getSavedChannelPassword(channelId: number): Promise<string> {
  const requestId = `channel-password-${channelId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise(resolve => {
    const finish = (password: string) => {
      window.clearTimeout(timeout);
      bridge.off('voice.channelPassword', handleResponse);
      resolve(password);
    };
    const handleResponse = (data: unknown) => {
      const response = data as ChannelPasswordResponse | null;
      if (response?.requestId === requestId && response.channelId === channelId && typeof response.password === 'string') {
        finish(response.password);
      }
    };
    const timeout = window.setTimeout(() => finish(''), 250);
    bridge.on('voice.channelPassword', handleResponse);
    bridge.send('voice.getChannelPassword', { channelId, requestId });
  });
}
