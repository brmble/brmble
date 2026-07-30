import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomCompanionUploadDialog,
  type CompanionCreator,
  type MatrixUploadClient,
} from './CustomCompanionUploadDialog';

const guidance = 'For correct animation, use a PNG or WebP sheet with 8 columns \u00d7 9 rows of equal cells. 1536 \u00d7 1872 px is recommended; for predictable results, do not exceed 3072 \u00d7 3744 px. Keep the file under 5 MiB.';
const privacy = 'Only upload artwork you own or have permission to share. Your name will be shown to everyone on this server, and moderators can remove the sprite.';

let previewResult: 'ready' | 'error' = 'ready';

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 900;

  set src(_value: string) {
    queueMicrotask(() => {
      if (previewResult === 'ready') this.onload?.();
      else this.onerror?.();
    });
  }
}

function setup(overrides?: {
  uploadContent?: ReturnType<typeof vi.fn>;
  createCompanion?: ReturnType<typeof vi.fn>;
  onClose?: ReturnType<typeof vi.fn>;
  onSuccess?: ReturnType<typeof vi.fn>;
  onActivityChange?: ReturnType<typeof vi.fn>;
}) {
  const uploadContent = (overrides?.uploadContent
    ?? vi.fn().mockResolvedValue({
      content_uri: 'mxc://test/sprite',
    })) as unknown as MatrixUploadClient['uploadContent'];
  const createCompanion = (overrides?.createCompanion
    ?? vi.fn().mockResolvedValue({})) as unknown as CompanionCreator['createCompanion'];
  const props = {
    isOpen: true,
    matrixClient: {
      uploadContent,
    },
    companions: {
      createCompanion,
    },
    onClose: (overrides?.onClose ?? vi.fn()) as unknown as () => void,
    onSuccess: (overrides?.onSuccess ?? vi.fn()) as unknown as () => void,
    onActivityChange: (overrides?.onActivityChange ?? vi.fn()) as unknown as (active: boolean) => void,
  };
  render(<CustomCompanionUploadDialog {...props} />);
  return props;
}

async function chooseFile(
  user: ReturnType<typeof userEvent.setup>,
  file = new File(['bytes'], 'sprite.png', { type: 'image/png' }),
) {
  await user.upload(screen.getByLabelText('Sprite sheet'), file);
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  file = new File(['bytes'], 'sprite.png', { type: 'image/png' }),
) {
  await user.type(screen.getByLabelText('Companion name'), 'Orbit');
  await chooseFile(user, file);
}

describe('CustomCompanionUploadDialog', () => {
  beforeEach(() => {
    previewResult = 'ready';
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:preview'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows exact layout guidance and ownership copy', () => {
    setup();
    expect(screen.getByText(guidance)).toBeVisible();
    expect(screen.getByText(privacy)).toBeVisible();
  });

  it.each([
    ['sprite.jpg', 'image/jpeg'],
    ['sprite', ''],
    ['sprite.png', 'image/gif'],
    ['sprite.png', 'image/webp'],
  ])('blocks unsupported file %s with browser MIME %s', async (name, type) => {
    const user = userEvent.setup({ applyAccept: false });
    const { matrixClient } = setup();
    await user.type(screen.getByLabelText('Companion name'), 'Orbit');
    await chooseFile(user, new File(['bytes'], name, { type }));

    expect(screen.getByText('Choose a PNG or WebP file.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upload sprite' })).toBeDisabled();
    expect(matrixClient.uploadContent).not.toHaveBeenCalled();
  });

  it('blocks files larger than 5 MiB', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText('Companion name'), 'Orbit');
    await chooseFile(user, new File([new Uint8Array(5_242_881)], 'sprite.png', {
      type: 'image/png',
    }));
    expect(screen.getByRole('button', { name: 'Upload sprite' })).toBeDisabled();
  });

  it.each(['', 'bad/name', 'x'.repeat(33)])('blocks invalid name %j', async name => {
    const user = userEvent.setup();
    setup();
    if (name) await user.type(screen.getByLabelText('Companion name'), name);
    await chooseFile(user);
    expect(screen.getByRole('button', { name: 'Upload sprite' })).toBeDisabled();
  });

  it.each([
    ['sprite.PNG', ''],
    ['sprite.WEBP', 'image/webp'],
  ])('allows uppercase extension %s and MIME %s for server verification', async (name, type) => {
    const user = userEvent.setup();
    setup();
    await fillValidForm(user, new File(['bytes'], name, { type }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload sprite' })).toBeEnabled());
  });

  it('keeps an unusual safe layout eligible and shows representative rows', async () => {
    const user = userEvent.setup();
    setup();
    await fillValidForm(user);

    await waitFor(() => {
      expect(screen.getByText('800 \u00d7 900 px')).toBeVisible();
      expect(screen.getByTestId('companion-preview-row-1')).toBeVisible();
    });
    const idle = screen.getByTestId('companion-preview-row-1');
    const message = screen.getByTestId('companion-preview-row-4');
    const speaking = screen.getByTestId('companion-preview-row-9');
    expect(message).toBeVisible();
    expect(speaking).toBeVisible();
    expect(idle.style.getPropertyValue('--custom-preview-last-frame-position')).toBe('71.428571%');
    expect(message.style.getPropertyValue('--custom-preview-last-frame-position')).toBe('42.857143%');
    expect(speaking.style.getPropertyValue('--custom-preview-frame-step-count')).toBe('5');
    expect(screen.getByRole('button', { name: 'Upload sprite' })).toBeEnabled();
  });

  it('treats preview failure as non-blocking', async () => {
    previewResult = 'error';
    const user = userEvent.setup();
    const { matrixClient } = setup();
    await fillValidForm(user);

    expect(await screen.findByText('Preview unavailable; the server will verify this image before accepting it.')).toBeVisible();
    const submit = screen.getByRole('button', { name: 'Upload sprite' });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(matrixClient.uploadContent).toHaveBeenCalledOnce();
  });

  it('uploads media then creates an entry with name and media URI only', async () => {
    const user = userEvent.setup();
    const { matrixClient, companions, onSuccess } = setup();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Upload sprite' }));

    await waitFor(() => expect(companions.createCompanion).toHaveBeenCalledWith(
      'Orbit',
      'mxc://test/sprite',
    ));
    expect(matrixClient.uploadContent).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ name: 'sprite.png', type: 'image/png' }),
    );
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(screen.getByText('Custom companion uploaded.')).toBeVisible();
  });

  it.each([
    ['invalid_image', 'This image is damaged or could not be decoded.'],
    ['unsafe_image_dimensions', 'Image dimensions are too large. Use at most 4096 \u00d7 4096 px and 12,000,000 total pixels.'],
    ['animated_image_not_supported', 'Animated PNG and WebP files aren\u2019t supported. Upload a still sprite sheet.'],
    ['unsupported_file_type', 'Choose a PNG or WebP file.'],
  ])('maps server code %s', async (code, message) => {
    const user = userEvent.setup();
    const createCompanion = vi.fn().mockRejectedValue(
      Object.assign(new Error('request failed'), {
        body: JSON.stringify({ code }),
      }),
    );
    setup({ createCompanion });
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Upload sprite' }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByLabelText('Companion name')).toHaveValue('Orbit');
    expect(screen.getByLabelText('Sprite sheet')).toHaveProperty('files.length', 1);
  });

  it('replaces files and revokes superseded preview URLs', async () => {
    const user = userEvent.setup();
    setup();
    await chooseFile(user);
    await chooseFile(user, new File(['new'], 'new.webp', { type: 'image/webp' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('cancels before submission', async () => {
    const user = userEvent.setup();
    const { onClose, matrixClient } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(matrixClient.uploadContent).not.toHaveBeenCalled();
  });

  it('suppresses duplicate submission and locks every close path while active', async () => {
    let resolveUpload!: (value: { content_uri: string }) => void;
    const uploadContent = vi.fn(() => new Promise<{ content_uri: string }>(resolve => {
      resolveUpload = resolve;
    }));
    const onClose = vi.fn();
    const onActivityChange = vi.fn();
    const user = userEvent.setup();
    setup({ uploadContent, onClose, onActivityChange });
    await fillValidForm(user);
    const submit = screen.getByRole('button', { name: 'Upload sprite' });
    await user.click(submit);
    fireEvent.click(submit);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('custom-companion-upload-overlay'));

    expect(uploadContent).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByText('Keep this dialog open while the upload finishes.')).toBeVisible();
    expect(onActivityChange).toHaveBeenLastCalledWith(true);

    resolveUpload({ content_uri: 'mxc://test/sprite' });
    await waitFor(() => expect(onActivityChange).toHaveBeenLastCalledWith(false));
  });
});
