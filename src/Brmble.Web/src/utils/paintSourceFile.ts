export type PaintSourceOrigin = 'file' | 'paste' | 'chat';

export const PAINT_SOURCE_ACCEPT =
  '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

export const MAX_PAINT_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_PAINT_SOURCE_DIMENSION = 4096;
const EXTENSION_BY_MIME: Record<string, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function paintSourceExtension(
  mimeType: string,
): 'png' | 'jpg' | 'webp' | null {
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? null;
}

export function isSupportedPaintSourceMimeType(mimeType: string): boolean {
  return paintSourceExtension(mimeType) !== null;
}

function unusableMessage(origin: PaintSourceOrigin): string {
  if (origin === 'paste') {
    return 'This clipboard image cannot be used. Try copying another image or choose a file.';
  }
  return origin === 'chat'
    ? 'This chat image cannot be used as a Paint source.'
    : 'This image cannot be used. Try choosing another file.';
}

function typeMessage(origin: PaintSourceOrigin): string {
  if (origin === 'paste') {
    return 'This clipboard image cannot be used. Copy a PNG, JPEG, or WebP image, or choose a file.';
  }
  return origin === 'chat'
    ? 'This chat image type cannot be used. Use a PNG, JPEG, or WebP image.'
    : 'This image type cannot be used. Choose a PNG, JPEG, or WebP image.';
}

function sizeMessage(origin: PaintSourceOrigin): string {
  if (origin === 'paste') {
    return 'The pasted image is too large to use as a Paint source.';
  }
  return origin === 'chat'
    ? 'This chat image is too large to use as a Paint source.'
    : 'The selected image is too large to use as a Paint source.';
}

async function decodedDimensions(file: File): Promise<{
  width: number;
  height: number;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function preparePaintSourceFile(
  file: File,
  origin: PaintSourceOrigin,
): Promise<File> {
  const extension = paintSourceExtension(file.type);
  if (!extension) {
    throw new Error(typeMessage(origin));
  }
  if (file.size === 0) {
    throw new Error(unusableMessage(origin));
  }

  if (file.size > MAX_PAINT_SOURCE_BYTES) {
    throw new Error(sizeMessage(origin));
  }

  let dimensions: { width: number; height: number };
  try {
    dimensions = await decodedDimensions(file);
  } catch {
    throw new Error(unusableMessage(origin));
  }
  if (dimensions.width < 1 || dimensions.height < 1) {
    throw new Error(unusableMessage(origin));
  }
  if (
    dimensions.width > MAX_PAINT_SOURCE_DIMENSION
    || dimensions.height > MAX_PAINT_SOURCE_DIMENSION
  ) {
    throw new Error(
      'This image is too large. Choose an image no larger than 4096 by 4096 pixels.',
    );
  }

  return origin === 'paste'
    ? new File([file], `Pasted screenshot.${extension}`, {
        type: file.type.toLowerCase(),
        lastModified: file.lastModified,
      })
    : file;
}
