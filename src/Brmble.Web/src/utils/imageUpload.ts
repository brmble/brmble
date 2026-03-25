import { MAX_SIZE_BYTES, ALLOWED_MIMETYPES } from './parseMessageMedia';

export interface ValidationError {
  type: 'invalid-type' | 'too-large' | 'empty';
  message: string;
}

export function validateImageFile(file: File): ValidationError | null {
  if (file.size === 0) {
    return { type: 'empty', message: '' };
  }
  if (!ALLOWED_MIMETYPES.includes(file.type)) {
    return { type: 'invalid-type', message: 'Only PNG, JPEG, GIF, and WebP images are supported' };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { type: 'too-large', message: 'Image must be under 5MB' };
  }
  return null;
}

export function encodeForMumble(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(`<img src="${dataUrl}" />`);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
