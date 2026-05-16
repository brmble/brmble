interface WebView2MessageEvent {
  data: {
    type: string;
    data?: unknown;
  };
}

interface WebView2 {
  addEventListener(type: 'message', handler: (event: WebView2MessageEvent) => void): void;
  postMessage(message: { type: string; data?: unknown }): void;
}

interface Window {
  chrome?: {
    webview?: WebView2;
  };
}
