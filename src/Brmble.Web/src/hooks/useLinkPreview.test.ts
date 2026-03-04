import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLinkPreview, extractFirstUrl, clearPreviewCache } from './useLinkPreview';

beforeEach(() => {
  clearPreviewCache();
});

describe('extractFirstUrl', () => {
  it('extracts http URL from text', () => {
    expect(extractFirstUrl('check out http://example.com ok')).toBe('http://example.com');
  });

  it('extracts https URL from text', () => {
    expect(extractFirstUrl('see https://github.com/brmble/brmble for info')).toBe('https://github.com/brmble/brmble');
  });

  it('returns null when no URL present', () => {
    expect(extractFirstUrl('just a regular message')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractFirstUrl('')).toBeNull();
  });

  it('extracts only the first URL', () => {
    expect(extractFirstUrl('first https://a.com then https://b.com')).toBe('https://a.com');
  });

  it('ignores mxc:// URLs', () => {
    expect(extractFirstUrl('mxc://server/media123')).toBeNull();
  });

  it('handles URL with path and query', () => {
    expect(extractFirstUrl('link: https://example.com/path?q=1&b=2')).toBe('https://example.com/path?q=1&b=2');
  });

  it('stops at closing paren or bracket', () => {
    expect(extractFirstUrl('(see https://example.com)')).toBe('https://example.com');
  });
});

describe('useLinkPreview', () => {
  it('returns null preview when url is null', () => {
    const { result } = renderHook(() => useLinkPreview(null, null));
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('returns null preview when client is null', () => {
    const { result } = renderHook(() => useLinkPreview('https://example.com', null));
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fetches preview and returns OG data', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockResolvedValue({
        'og:title': 'Example',
        'og:description': 'An example page',
        'og:image': 'mxc://server/image123',
      }),
      mxcUrlToHttp: vi.fn((url: string) => url.replace('mxc://', 'https://matrix.example.com/_matrix/media/v3/download/')),
    };

    const { result } = renderHook(() => useLinkPreview('https://example.com', mockClient as any));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.preview).not.toBeNull();
    });

    expect(result.current.preview?.title).toBe('Example');
    expect(result.current.preview?.description).toBe('An example page');
    expect(result.current.preview?.imageUrl).toBe('https://matrix.example.com/_matrix/media/v3/download/server/image123');
    expect(result.current.preview?.url).toBe('https://example.com');
  });

  it('returns null preview on fetch error', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockRejectedValue(new Error('Not found')),
      mxcUrlToHttp: vi.fn(),
    };

    const { result } = renderHook(() => useLinkPreview('https://bad.com', mockClient as any));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.preview).toBeNull();
  });

  it('uses cache on subsequent calls with same URL', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockResolvedValue({
        'og:title': 'Cached',
      }),
      mxcUrlToHttp: vi.fn(),
    };

    const { result, rerender } = renderHook(
      ({ url }) => useLinkPreview(url, mockClient as any),
      { initialProps: { url: 'https://cached.com' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ url: 'https://cached.com' });

    expect(mockClient.getUrlPreview).toHaveBeenCalledTimes(1);
  });

  it('extracts domain from URL', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockResolvedValue({
        'og:title': 'Title',
      }),
      mxcUrlToHttp: vi.fn(),
    };

    const { result } = renderHook(() => useLinkPreview('https://www.example.com/page', mockClient as any));

    await waitFor(() => expect(result.current.preview).not.toBeNull());

    expect(result.current.preview?.domain).toBe('www.example.com');
  });
});
