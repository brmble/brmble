import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '../../types';
import './Avatar.css';

interface AvatarProps {
  user: Pick<User, 'name' | 'matrixUserId' | 'avatarUrl'>;
  size: number;
  speaking?: boolean;
  className?: string;
}

type FallbackState = 'image' | 'platform-logo' | 'letter';

/** Mumble headset icon — extracted paths only, no circle background */
function MumbleIcon({ size }: { size: number }) {
  return (
    <svg
      className="avatar-platform-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 18v-6a9 9 0 0 1 18 0v6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z"
        fill="currentColor"
        opacity="0.6"
      />
      <path
        d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}

/** Brmble concentric rings icon */
function BrmbleIcon({ size }: { size: number }) {
  return (
    <svg
      className="avatar-platform-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.8" />
      <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

export default function Avatar({ user, size, speaking, className }: AvatarProps) {
  const initialFallback = user.avatarUrl ? 'image' : 'platform-logo';
  const [fallback, setFallback] = useState<FallbackState>(initialFallback);
  const prevUrlRef = useRef(user.avatarUrl);

  // Reset fallback to 'image' when avatarUrl changes from falsy to truthy
  useEffect(() => {
    if (user.avatarUrl !== prevUrlRef.current) {
      prevUrlRef.current = user.avatarUrl;
      if (user.avatarUrl) {
        setFallback('image');
      } else {
        setFallback('platform-logo');
      }
    }
  }, [user.avatarUrl]);

  const onImageError = useCallback(() => {
    setFallback((prev) => {
      if (prev === 'image') return 'platform-logo';
      return 'letter';
    });
  }, []);

  const letter = user.name?.charAt(0).toUpperCase() || '?';
  const isMumbleOnly = !user.matrixUserId;
  const iconSize = Math.max(Math.round(size * 0.6), 12);
  const fontSize = Math.max(Math.round(size * 0.45), 10);

  const classes = [
    'avatar',
    isMumbleOnly ? 'avatar--mumble' : 'avatar--brmble',
    speaking ? 'speaking' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {fallback === 'image' && user.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.name} onError={onImageError} />
      ) : fallback === 'platform-logo' ? (
        isMumbleOnly ? <MumbleIcon size={iconSize} /> : <BrmbleIcon size={iconSize} />
      ) : (
        <span className="avatar-letter" style={{ fontSize }}>
          {letter}
        </span>
      )}
    </div>
  );
}
