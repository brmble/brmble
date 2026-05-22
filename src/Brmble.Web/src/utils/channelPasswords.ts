import bridge from '../bridge';

interface ChannelPasswordResponse {
  requestId?: string;
  channelId?: number;
  password?: string;
}

export function getSavedChannelPassword(channelId: number): Promise<string> {
  const requestId = `channel-password-${channelId}`;
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => resolve(''), 250);
    bridge.once('voice.channelPassword', (data: unknown) => {
      const response = data as ChannelPasswordResponse | null;
      if (response?.requestId === requestId && response.channelId === channelId && typeof response.password === 'string') {
        window.clearTimeout(timeout);
        resolve(response.password);
        return;
      }
      window.clearTimeout(timeout);
      resolve('');
    });
    bridge.send('voice.getChannelPassword', { channelId, requestId });
  });
}
