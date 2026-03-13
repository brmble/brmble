import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '../../types';
import brmbleLogo from '../../assets/brmble-logo.svg';
import mumbleLogo from '../../assets/mumble-seeklogo.svg';
import './Avatar.css';

interface AvatarProps {
  user: Pick<User, 'name' | 'matrixUserId' | 'avatarUrl'>;
  size: number;
  speaking?: boolean;
  className?: string;
}

type FallbackState = 'image' | 'platform-logo' | 'letter';

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
  const platformLogo = isMumbleOnly ? mumbleLogo : brmbleLogo;
  const fontSize = Math.max(Math.round(size * 0.45), 10);

  const classes = ['avatar', speaking ? 'speaking' : '', className || '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {fallback === 'image' && user.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.name} onError={onImageError} />
      ) : fallback === 'platform-logo' ? (
        <img
          className="avatar-platform-logo"
          src={platformLogo}
          alt=""
          aria-hidden="true"
          onError={onImageError}
        />
      ) : (
        <span className="avatar-letter" style={{ fontSize }}>
          {letter}
        </span>
      )}
    </div>
  );
}
