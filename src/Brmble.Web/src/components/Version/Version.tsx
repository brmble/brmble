import { useState, useEffect } from 'react';
import './Version.css';

interface VersionInfo {
  version: string;
}

export function Version() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch('/version.json')
      .then(res => {
        if (!res.ok) return null;
        return res.json() as Promise<VersionInfo>;
      })
      .then(data => {
        if (data?.version) {
          const date = new Date(data.version);
          if (isNaN(date.getTime())) return;
          const formatted = `v${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCHours()).padStart(2, '0')}`;
          setVersion(formatted);
        }
      })
      .catch(() => {});
  }, []);

  if (!version) return null;

  return <div className="version-display">{version}</div>;
}
