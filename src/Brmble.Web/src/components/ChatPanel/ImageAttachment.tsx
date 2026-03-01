import { useState } from 'react';
import type { MediaAttachment } from '../../types';
import './ImageAttachment.css';

interface ImageAttachmentProps {
  attachment: MediaAttachment;
  onOpenLightbox: (url: string) => void;
}

export function ImageAttachment({ attachment, onOpenLightbox }: ImageAttachmentProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const src = attachment.thumbnailUrl ?? attachment.url;

  if (error) {
    return (
      <div className="image-attachment image-attachment--error">
        <span>Failed to load image</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="image-attachment"
      onClick={() => onOpenLightbox(attachment.url)}
    >
      {!loaded && <div className="image-attachment__placeholder" />}
      <img
        src={src}
        alt=""
        className={`image-attachment__img ${loaded ? '' : 'image-attachment__img--loading'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </button>
  );
}
