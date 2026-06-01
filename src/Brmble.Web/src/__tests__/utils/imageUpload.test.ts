import { describe, it, expect } from 'vitest';
import {
  validateImageFile,
  encodeForMumble,
  prepareImageForMumble,
  MUMBLE_SAFE_MESSAGE_BYTES,
} from '../../utils/imageUpload';

describe('validateImageFile', () => {
  it('accepts valid PNG file', () => {
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid JPEG file', () => {
    const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid GIF file', () => {
    const file = new File(['data'], 'test.gif', { type: 'image/gif' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid WebP file', () => {
    const file = new File(['data'], 'test.webp', { type: 'image/webp' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('rejects unsupported file type', () => {
    const file = new File(['data'], 'test.bmp', { type: 'image/bmp' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('invalid-type');
  });

  it('rejects non-image file', () => {
    const file = new File(['data'], 'test.pdf', { type: 'application/pdf' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('invalid-type');
  });

  it('rejects file over 5MB', () => {
    const data = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([data], 'big.png', { type: 'image/png' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('too-large');
  });

  it('accepts file exactly at 5MB', () => {
    const data = new Uint8Array(5 * 1024 * 1024);
    const file = new File([data], 'exact.png', { type: 'image/png' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('returns empty type for 0-byte file', () => {
    const file = new File([], 'empty.png', { type: 'image/png' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('empty');
  });
});

describe('encodeForMumble', () => {
  it('wraps file as base64 img tag', async () => {
    const file = new File(['hello'], 'test.png', { type: 'image/png' });
    const result = await encodeForMumble(file);
    expect(result).toMatch(/^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" \/>$/);
  });
});

describe('prepareImageForMumble', () => {
  it('returns a sendable payload when the full html img tag fits inside the safe limit', async () => {
    const file = new File(['hello'], 'small.png', { type: 'image/png' });

    const result = await prepareImageForMumble(file);

    expect(result).toEqual({
      kind: 'sendable',
      payload: expect.stringMatching(/^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" \/>$/),
    });
  });

  it('returns oversized when the full html payload exceeds the safe limit', async () => {
    const rawBytes = new Uint8Array(MUMBLE_SAFE_MESSAGE_BYTES);
    const file = new File([rawBytes], 'huge.png', { type: 'image/png' });

    const result = await prepareImageForMumble(file);

    expect(result.kind).toBe('too-large');
    if (result.kind !== 'too-large') {
      throw new Error('Expected too-large result');
    }
    expect(result).toEqual({
      kind: 'too-large',
      payloadLength: expect.any(Number),
    });
    expect(result.payloadLength).toBeGreaterThan(MUMBLE_SAFE_MESSAGE_BYTES);
  });

  it('checks the rendered html payload length instead of the raw file size', async () => {
    const file = new File(['x'], 'tiny.png', { type: 'image/png' });

    const result = await prepareImageForMumble(file);

    expect(result.kind).toBe('sendable');
    if (result.kind !== 'sendable') {
      throw new Error('Expected sendable result');
    }
    expect(result.payload.length).toBeGreaterThan(file.size);
  });
});
