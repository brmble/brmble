import { useState, useCallback, useRef, useEffect } from 'react';

export function useLeaveVoiceCooldown(duration: number = 1000) {
  const [isOnCooldown, setIsOnCooldown] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    if (isOnCooldown) return;
    
    setIsOnCooldown(true);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      setIsOnCooldown(false);
    }, duration);
  }, [isOnCooldown, duration]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { isOnCooldown, trigger };
}