import { useEffect } from 'react';
import './ImageLightbox.css';

interface ImageLightboxProps {
  url: string;
  onClose: () => void;
}

export function ImageLightbox({ url, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="image-lightbox" onClick={onClose}>
      <img
        src={url}
        alt=""
        className="image-lightbox__img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
