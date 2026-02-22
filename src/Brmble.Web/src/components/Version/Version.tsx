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
          const formatted = `v${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}.${String(date.getHours()).padStart(2, '0')}`;
          setVersion(formatted);
        }
      })
      .catch(() => {});
  }, []);

  if (!version) return null;

  return <div className="version-display">{version}</div>;
}
