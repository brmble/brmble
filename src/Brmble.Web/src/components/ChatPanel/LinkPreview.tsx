import type { MatrixClient } from 'matrix-js-sdk';
import { useLinkPreview } from '../../hooks/useLinkPreview';
import './LinkPreview.css';

interface LinkPreviewProps {
  url: string;
  client: MatrixClient | null;
}

export function LinkPreview({ url, client }: LinkPreviewProps) {
  const { preview, loading } = useLinkPreview(url, client);

  if (loading) {
    return <div className="link-preview__placeholder" />;
  }

  if (!preview) {
    return null;
  }

  return (
    <a
      className="link-preview"
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {preview.imageUrl && (
        <img
          className="link-preview__thumb"
          src={preview.imageUrl}
          alt=""
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="link-preview__body">
        {preview.title && <p className="link-preview__title">{preview.title}</p>}
        {preview.description && <p className="link-preview__description">{preview.description}</p>}
        <p className="link-preview__domain">{preview.domain}</p>
      </div>
    </a>
  );
}
