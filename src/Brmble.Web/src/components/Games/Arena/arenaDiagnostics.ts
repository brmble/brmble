// TEMPORARY diagnostic for the "forgets I'm holding a direction" input bug.
// Drawn on the arena so it can be read while playing rather than through DevTools.
// Remove once the cause is identified.
export const diag = {
  releases: 0,
  lastRelease: '-',
  rejects: 0,
  lastReject: '-',
  neutrals: 0,
  lastMove: '0,0',
  held: '',
};

export function noteRelease(reason: string) {
  diag.releases++;
  diag.lastRelease = reason;
}

export function noteReject(reason: string) {
  diag.rejects++;
  diag.lastReject = reason;
}

export function noteMove(moveX: number, moveY: number, held: Iterable<string>) {
  diag.lastMove = `${moveX},${moveY}`;
  diag.held = [...held].map(code => code.replace('Key', '').replace('Mouse', 'M')).join('');
}

export function noteNeutral() {
  diag.neutrals++;
}
