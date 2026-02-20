type MessageHandler = (data: unknown) => void;

const bridge = {
  _handlers: new Map<string, MessageHandler[]>(),

  init() {
    const webview = window.chrome?.webview;
    if (webview) {
      webview.addEventListener('message', (event: { data: unknown }) => {
        this._handleMessage(event as { data: { type: string; data?: unknown } | { type: string; data?: unknown }[] });
      });
    }
  },

  _handleMessage(event: { data: { type: string; data?: unknown } | { type: string; data?: unknown }[] }) {
    try {
      const payload = event.data;
      const messages = Array.isArray(payload) ? payload : [payload];

      for (const msg of messages) {
        const { type, data } = msg;
        console.log('[JS Bridge] Received:', type, data);

        if (this._handlers.has(type)) {
          this._handlers.get(type)?.forEach(handler => handler(data));
        }
      }
    } catch (e) {
      console.error('[JS Bridge] Error:', e);
    }
  },

  send(type: string, data: unknown = null) {
    const webview = window.chrome?.webview;
    if (webview) {
      webview.postMessage({ type, data });
    } else {
      console.warn('[JS Bridge] Not running in WebView2');
    }
  },

  on(type: string, handler: MessageHandler) {
    if (!this._handlers.has(type)) {
      this._handlers.set(type, []);
    }
    this._handlers.get(type)?.push(handler);
  },

  off(type: string, handler: MessageHandler) {
    if (this._handlers.has(type)) {
      const handlers = this._handlers.get(type);
      const index = handlers?.indexOf(handler) ?? -1;
      if (index > -1) {
        handlers?.splice(index, 1);
      }
    }
  }
};

bridge.init();

export default bridge;
