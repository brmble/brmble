import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPaintSourceAttachment,
  prepareChatImagePaintSource,
} from './chatImagePaintSource';

afterEach(() => {
  vi.unstubAllGlobals();
});

function installDecodeHarness(decode = vi.fn().mockResolvedValue(undefined)) {
  const createObjectURL = vi.fn().mockReturnValue('blob:paint-source');
  const revokeObjectURL = vi.fn();

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });
  vi.stubGlobal('Image', class {
    set src(_value: string) {}
    decode = decode;
  });

  return { createObjectURL, revokeObjectURL, decode };
}

describe('isPaintSourceAttachment', () => {
  it('accepts a displayed image with a supported or unknown image MIME type', () => {
    expect(isPaintSourceAttachment({
      type: 'image',
      url: 'https://matrix.example/image',
      mimetype: 'image/png',
    })).toBe(true);
    expect(isPaintSourceAttachment({
      type: 'gif',
      url: 'data:image/gif;base64,R0lG',
    })).toBe(true);
  });

  it('rejects empty URLs and known unsupported MIME types', () => {
    expect(isPaintSourceAttachment({
      type: 'image',
      url: '',
      mimetype: 'image/png',
    })).toBe(false);
    expect(isPaintSourceAttachment({
      type: 'image',
      url: 'https://matrix.example/image',
      mimetype: 'image/bmp',
    })).toBe(false);
  });
});

describe('prepareChatImagePaintSource', () => {
  it('downloads, decodes, and preserves the Matrix filename and MIME type', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(
        new Blob(['png-bytes'], { type: 'image/png' }),
      ),
    });
    const { createObjectURL, revokeObjectURL, decode } =
      installDecodeHarness();

    const file = await prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/image',
      mimetype: 'image/png',
      filename: 'shared-board.png',
    }, fetcher as unknown as typeof fetch);

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

  it('uses the response MIME type and a deterministic fallback filename', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(
        new Blob(['jpg-bytes'], { type: 'image/jpeg' }),
      ),
    });
    installDecodeHarness();

    const file = await prepareChatImagePaintSource({
      type: 'image',
      url: 'data:image/jpeg;base64,anBn',
    }, fetcher as unknown as typeof fetch);

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

  it('rejects unsupported downloaded content', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(
        new Blob(['bmp-bytes'], { type: 'image/bmp' }),
      ),
    });

    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/image',
    }, fetcher as unknown as typeof fetch))
      .rejects.toThrow('This image type cannot be used for paint.');
  });

  it('rejects undecodable image bytes and always revokes the object URL', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(
        new Blob(['not-an-image'], { type: 'image/png' }),
      ),
    });
    const { revokeObjectURL } = installDecodeHarness(
      vi.fn().mockRejectedValue(new Error('decode failed')),
    );

    await expect(prepareChatImagePaintSource({
      type: 'image',
      url: 'https://matrix.example/broken',
      mimetype: 'image/png',
    }, fetcher as unknown as typeof fetch))
      .rejects.toThrow('Unable to decode the chat image.');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:paint-source');
  });
});
