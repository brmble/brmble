import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  PAINT_SOURCE_ACCEPT,
  isSupportedPaintSourceMimeType,
  paintSourceExtension,
  preparePaintSourceFile,
} from './paintSourceFile';

const TEN_MIB = 10 * 1024 * 1024;

let naturalWidth = 1280;
let naturalHeight = 720;
let decode = vi.fn<() => Promise<void>>();

beforeEach(() => {
  naturalWidth = 1280;
  naturalHeight = 720;
  decode = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:paint-source'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('Image', class {
    src = '';
    get naturalWidth() { return naturalWidth; }
    get naturalHeight() { return naturalHeight; }
    decode = decode;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preparePaintSourceFile', () => {
  it('advertises exactly the Paint-supported picker formats', () => {
    expect(PAINT_SOURCE_ACCEPT).toBe(
      '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
    );
  });

  it('exposes the same MIME and extension policy to chat-image preparation', () => {
    expect(isSupportedPaintSourceMimeType('image/png')).toBe(true);
    expect(isSupportedPaintSourceMimeType('IMAGE/JPEG')).toBe(true);
    expect(isSupportedPaintSourceMimeType('image/gif')).toBe(false);
    expect(paintSourceExtension('image/webp')).toBe('webp');
    expect(paintSourceExtension('image/svg+xml')).toBeNull();
  });

  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
  ])('accepts a decodable %s paste and gives it a useful name', async (
    type,
    extension,
  ) => {
    const clipboardFile = new File(['pixels'], 'image', { type });

    const result = await preparePaintSourceFile(
      clipboardFile,
      'paste',
      TEN_MIB,
    );

    expect(result).not.toBe(clipboardFile);
    expect(result.name).toBe(`Pasted screenshot.${extension}`);
    expect(result.type).toBe(type);
    expect(result.size).toBe(clipboardFile.size);
    expect(decode).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:paint-source');
  });

  it('preserves the original filename and object for a selected file', async () => {
    const selected = new File(['pixels'], 'diagram.png', {
      type: 'image/png',
    });

    await expect(preparePaintSourceFile(selected, 'file', TEN_MIB))
      .resolves.toBe(selected);
  });

  it('preserves a valid chat-image file after applying the same checks', async () => {
    const chatImage = new File(['pixels'], 'shared-board.jpg', {
      type: 'image/jpeg',
    });

    await expect(preparePaintSourceFile(chatImage, 'chat', TEN_MIB))
      .resolves.toBe(chatImage);
  });

  it.each(['image/gif', 'image/bmp', 'image/svg+xml'])
  ('rejects unsupported image type %s before decoding', async (type) => {
    await expect(preparePaintSourceFile(
      new File(['pixels'], 'unsupported', { type }),
      'paste',
      TEN_MIB,
    )).rejects.toThrow(
      'This clipboard image cannot be used. Copy a PNG, JPEG, or WebP image, or choose a file.',
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it('rejects an empty clipboard image', async () => {
    await expect(preparePaintSourceFile(
      new File([], 'empty.png', { type: 'image/png' }),
      'paste',
      TEN_MIB,
    )).rejects.toThrow(
      'This clipboard image cannot be used. Try copying another image or choose a file.',
    );
  });

  it('rejects a file above the Paint 10 MiB limit', async () => {
    const oversized = new File(
      [new Uint8Array(TEN_MIB + 1)],
      'large.png',
      { type: 'image/png' },
    );

    await expect(preparePaintSourceFile(oversized, 'file'))
      .rejects.toThrow(
        'The selected image is too large to use as a Paint source.',
      );
  });

  it('uses a smaller Matrix upload limit for pasted images', async () => {
    await expect(preparePaintSourceFile(
      new File(['pixels'], 'image.png', { type: 'image/png' }),
      'paste',
      1,
    )).rejects.toThrow(
      'The pasted image is too large to use as a Paint source.',
    );
  });

  it('uses the Paint byte limit and chat-specific copy for a chat image', async () => {
    const oversized = new File(
      [new Uint8Array(TEN_MIB + 1)],
      'shared.png',
      { type: 'image/png' },
    );

    await expect(preparePaintSourceFile(oversized, 'chat'))
      .rejects.toThrow(
        'This chat image is too large to use as a Paint source.',
      );
  });

  it('rejects a file whose decoded dimensions exceed 4096 pixels', async () => {
    naturalWidth = 4097;

    await expect(preparePaintSourceFile(
      new File(['pixels'], 'wide.webp', { type: 'image/webp' }),
      'file',
      TEN_MIB,
    )).rejects.toThrow(
      'This image is too large. Choose an image no larger than 4096 by 4096 pixels.',
    );
  });

  it('rejects image bytes that the browser cannot decode and revokes the URL', async () => {
    decode.mockRejectedValue(new Error('decode failed'));

    await expect(preparePaintSourceFile(
      new File(['broken'], 'broken.png', { type: 'image/png' }),
      'paste',
      TEN_MIB,
    )).rejects.toThrow(
      'This clipboard image cannot be used. Try copying another image or choose a file.',
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:paint-source');
  });
});
