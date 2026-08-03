import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPaintSourceAttachment,
  prepareChatImagePaintSource,
} from './chatImagePaintSource';

const TEN_MIB = 10 * 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
});

function installDecodeHarness(options: {
  width?: number;
  height?: number;
  decode?: () => Promise<void>;
} = {}) {
  const createObjectURL = vi.fn().mockReturnValue('blob:paint-source');
  const revokeObjectURL = vi.fn();
  const decode = options.decode ?? vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });
  vi.stubGlobal('Image', class {
    src = '';
    naturalWidth = options.width ?? 1280;
    naturalHeight = options.height ?? 720;
    decode = decode;
  });

  return { createObjectURL, revokeObjectURL, decode };
}

function successfulFetch(blob: Blob): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': blob.type }),
    body: new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
        controller.close();
      },
    }),
  }) as unknown as typeof fetch;
}

describe('isPaintSourceAttachment', () => {
  it('accepts a supported image and an image whose MIME must be discovered', () => {
    expect(isPaintSourceAttachment({
      type: 'image',
      url: 'https://matrix.example/image',
      mimetype: 'image/png',
    })).toBe(true);
    expect(isPaintSourceAttachment({
      type: 'image',
      url: 'https://matrix.example/unknown',
    })).toBe(true);
  });

  it('rejects empty URLs, GIFs, and known unsupported MIME types', () => {
    expect(isPaintSourceAttachment({
      type: 'image',
      url: '',
      mimetype: 'image/png',
    })).toBe(false);
    expect(isPaintSourceAttachment({
      type: 'gif',
      url: 'data:image/gif;base64,R0lG',
      mimetype: 'image/gif',
    })).toBe(false);
    expect(isPaintSourceAttachment({
      type: 'image',
      url: 'https://matrix.example/image',
      mimetype: 'image/bmp',
    })).toBe(false);
  });
});

describe('prepareChatImagePaintSource', () => {
  it('downloads, validates, and preserves the Matrix filename and MIME type', async () => {
    const fetcher = successfulFetch(
      new Blob(['png-bytes'], { type: 'image/png' }),
    );
    const { createObjectURL, revokeObjectURL, decode } =
      installDecodeHarness();

    const file = await prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/image',
      mimetype: 'image/png',
      filename: 'shared-board.png',
    }, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://matrix.example/image',
      { signal: expect.any(AbortSignal) },
    );
    expect(file.name).toBe('shared-board.png');
    expect(file.type).toBe('image/png');
    expect(await file.text()).toBe('png-bytes');
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(decode).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:paint-source');
  });

  it('uses the response MIME type and shared extension for a fallback filename', async () => {
    installDecodeHarness();

    const file = await prepareChatImagePaintSource({
      type: 'image',
      url: 'data:image/jpeg;base64,anBn',
    }, successfulFetch(new Blob(['jpg-bytes'], { type: 'image/jpeg' })));

    expect(file.name).toBe('chat-image.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  it('rejects a failed download before a file is created', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/missing',
      mimetype: 'image/png',
    }, fetcher as unknown as typeof fetch))
      .rejects.toThrow('Unable to download the chat image.');
  });

  it('rejects unsupported downloaded content through the shared MIME policy', async () => {
    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/image',
    }, successfulFetch(new Blob(['bmp-bytes'], { type: 'image/bmp' }))))
      .rejects.toThrow(
        'This chat image type cannot be used. Use a PNG, JPEG, or WebP image.',
      );
  });

  it('rejects a downloaded chat image above the Paint 10 MiB limit', async () => {
    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/large',
      mimetype: 'image/png',
    }, successfulFetch(new Blob(
      [new Uint8Array(TEN_MIB + 1)],
      { type: 'image/png' },
    )))).rejects.toThrow(
      'This chat image is too large to use as a Paint source.',
    );
  });

  it('stops reading a streamed chat image when it exceeds the Paint 10 MiB limit', async () => {
    const firstChunk = new Uint8Array(TEN_MIB);
    const secondChunk = new Uint8Array(1);
    let pullCount = 0;
    let cancelReason: unknown;
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(firstChunk);
          } else if (pullCount === 2) {
            controller.enqueue(secondChunk);
          }
        },
        cancel(reason) {
          cancelReason = reason;
        },
      }),
      headers: new Headers({ 'content-type': 'image/png' }),
      blob: vi.fn().mockRejectedValue(new Error('full body was materialized')),
    });

    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/streaming-large',
      mimetype: 'image/png',
    }, fetcher as unknown as typeof fetch)).rejects.toThrow(
      'This chat image is too large to use as a Paint source.',
    );

    expect(pullCount).toBeLessThanOrEqual(3);
    expect(cancelReason).toBeDefined();
  });

  it('rejects a downloaded chat image above 4096 pixels', async () => {
    installDecodeHarness({ width: 4097 });

    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/wide',
      mimetype: 'image/webp',
    }, successfulFetch(new Blob(['webp-bytes'], { type: 'image/webp' }))))
      .rejects.toThrow(
        'This image is too large. Choose an image no larger than 4096 by 4096 pixels.',
      );
  });

  it('rejects undecodable chat image bytes and revokes the object URL', async () => {
    const { revokeObjectURL } = installDecodeHarness({
      decode: vi.fn().mockRejectedValue(new Error('decode failed')),
    });

    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/broken',
      mimetype: 'image/png',
    }, successfulFetch(new Blob(
      ['not-an-image'],
      { type: 'image/png' },
    )))).rejects.toThrow(
      'This chat image cannot be used as a Paint source.',
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:paint-source');
  });
});
