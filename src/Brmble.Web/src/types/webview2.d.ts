/**
 * Type augmentation for WebView2 host window
 * 
 * This extends the Window interface to include WebView2-specific APIs
 * available when running inside the Brmble client.
 */
declare global {
  interface Window {
    chrome?: {
      webview?: {
        addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
        postMessage(message: { type: string; data?: unknown }): void;
      };
    };
  }
}

export {};
