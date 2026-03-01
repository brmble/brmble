import { useEffect, useRef } from 'react';
import './ImageLightbox.css';

interface ImageLightboxProps {
  url: string;
  onClose: () => void;
}

export function ImageLightbox({ url, onClose }: ImageLightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    overlayRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      ref={overlayRef}
      tabIndex={-1}
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox__close"
        onClick={onClose}
        aria-label="Close lightbox"
      >
        &times;
      </button>
      <img
        src={url}
        alt=""
        className="image-lightbox__img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
