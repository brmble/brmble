import { useState, useEffect } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/i;

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  domain: string;
}

const cache = new Map<string, LinkPreviewData | null>();

export function clearPreviewCache() {
  cache.clear();
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

export function useLinkPreview(url: string | null, client: MatrixClient | null) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url || !client) {
      setPreview(null);
      setLoading(false);
      return;
    }

    if (cache.has(url)) {
      setPreview(cache.get(url) ?? null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    client.getUrlPreview(url, Date.now()).then(
      (data: Record<string, string | number | undefined>) => {
        if (cancelled) return;

        const title = data['og:title'] as string | undefined;
        const description = data['og:description'] as string | undefined;
        const ogImage = data['og:image'] as string | undefined;

        if (!title && !description && !ogImage) {
          cache.set(url, null);
          setPreview(null);
          setLoading(false);
          return;
        }

        let imageUrl: string | undefined;
        if (ogImage) {
          imageUrl = ogImage.startsWith('mxc://')
            ? (client.mxcUrlToHttp(ogImage, 400, 400, 'scale') ?? undefined)
            : ogImage;
        }

        let domain: string;
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = url;
        }

        const result: LinkPreviewData = { url, title, description, imageUrl, domain };
        cache.set(url, result);
        setPreview(result);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        // Don't cache errors — allow retry on next render
        setPreview(null);
        setLoading(false);
      }
    );

    return () => { cancelled = true; };
  }, [url, client]);

  return { preview, loading };
}
