import { useState, useEffect } from 'react';
import bridge from '../../bridge';
import './Version.css';

type WebView2HostWindow = Window & {
  chrome?: {
    webview?: unknown;
  };
};

export function Version() {
  const [version, setVersion] = useState<string | null>(() =>
    (window as WebView2HostWindow).chrome?.webview ? null : 'dev'
  );

  useEffect(() => {
    const onVersion = (data: unknown) => {
      const d = data as { version: string };
      if (d.version) setVersion(`v${d.version}`);
    };

    bridge.on('app.version', onVersion);
    return () => bridge.off('app.version', onVersion);
  }, []);

  if (!version) return null;

  return <div className="version-display">{version}</div>;
}
