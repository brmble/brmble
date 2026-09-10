import bridge from './bridge';

export function signalAppReadyAfterPaint(): () => void {
  let secondFrame: number | null = null;

  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      bridge.send('app.ready');
    });
  });

  return () => {
    cancelAnimationFrame(firstFrame);

    if (secondFrame !== null) {
      cancelAnimationFrame(secondFrame);
    }
  };
}
