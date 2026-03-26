import { useState, useEffect } from 'react';
import bridge from '../../bridge';
import './Version.css';

export function Version() {
  const [version, setVersion] = useState('dev');

  useEffect(() => {
    const onVersion = (data: unknown) => {
      const d = data as { version: string };
      if (d.version) setVersion(`v${d.version}`);
    };

    bridge.on('app.version', onVersion);
    return () => bridge.off('app.version', onVersion);
  }, []);

  return <div className="version-display">{version}</div>;
}
