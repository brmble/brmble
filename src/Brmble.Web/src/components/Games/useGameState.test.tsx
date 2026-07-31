import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameState } from './useGameState';
import { api, emit, resetHarness } from './duelTestHarness';

vi.mock('../../bridge', async () => ({ default: (await import('./duelTestHarness')).bridge }));
vi.mock('../../api/games', async () => (await import('./duelTestHarness')).api);

describe('useGameState', () => {
  beforeEach(resetHarness);

  describe('game.accepted', () => {
    it('clears the matching incoming challenge when the server accepts it', () => {
      const { result } = renderHook(() => useGameState(100));

      emit('game.invited', { offerId: 5, from: 22, gameType: 'deathroll' });
      expect(result.current.incomingInvite).not.toBeNull();
      act(() => result.current.acceptInvite());
      expect(result.current.accepting).toBe(true);

      emit('game.accepted', { offerId: 5 });

      expect(result.current.incomingInvite).toBeNull();
      expect(result.current.accepting).toBe(false);
    });

    it('clears the matching outgoing challenge without an outcome notification', () => {
      const { result } = renderHook(() => useGameState(100));

      emit('game.invitePending', { offerId: 9, target: 22, gameType: 'deathroll' });
      expect(result.current.outgoingInvite).not.toBeNull();

      emit('game.accepted', { offerId: 9 });

      expect(result.current.outgoingInvite).toBeNull();
      expect(result.current.inviteOutcome).toBeNull();
    });

    it('sets an outcome on decline, confirming the accepted path differs', () => {
      const { result } = renderHook(() => useGameState(100));

      emit('game.invitePending', { offerId: 9, target: 22, gameType: 'deathroll' });
      emit('game.declined', { offerId: 9 });

      expect(result.current.outgoingInvite).toBeNull();
      expect(result.current.inviteOutcome).toEqual({ kind: 'declined', targetSession: 22 });
    });

    it('ignores an accepted event for a different offer', () => {
      const { result } = renderHook(() => useGameState(100));

      emit('game.invited', { offerId: 5, from: 22, gameType: 'deathroll' });
      emit('game.accepted', { offerId: 4 });

      expect(result.current.incomingInvite?.offerId).toBe(5);
    });

    it('ignores an accepted event without an offerId', () => {
      const { result } = renderHook(() => useGameState(100));

      emit('game.invited', { offerId: 5, from: 22, gameType: 'deathroll' });
      emit('game.accepted', {});

      expect(result.current.incomingInvite?.offerId).toBe(5);
    });
  });

  describe('duel offer contracts', () => {
    it('uses offerId for responses and cancellation without accepting matchId aliases', () => {
      const { result } = renderHook(() => useGameState(11));
      emit('game.invited', { offerId: 5, matchId: 99, from: 22, gameType: 'rps' });
      act(() => result.current.acceptInvite());
      expect(api.respondOffer).toHaveBeenCalledWith(5, true);

      emit('game.invitePending', { matchId: 7, target: 22, gameType: 'rps' });
      act(() => result.current.cancelInvite());
      expect(api.cancelOffer).not.toHaveBeenCalled();
      emit('game.invitePending', { offerId: 7, target: 22, gameType: 'rps' });
      act(() => result.current.cancelInvite());
      expect(api.cancelOffer).toHaveBeenCalledWith(7);
      expect(api.forfeit).not.toHaveBeenCalled();
    });

    it('retains the completed source match id and configuration', () => {
      const { result } = renderHook(() => useGameState(11));
      emit('game.started', { matchId: 0, gameType: 'rps', format: 'bestOf3', rulesetVersion: 2, options: { bestOf: 3 }, views: [] });
      emit('game.ended', { matchId: 0, gameType: 'rps', draw: true });
      expect(result.current.ended).toMatchObject({
        matchId: 0,
        sourceMatchId: 0,
        gameType: 'rps',
        format: 'bestOf3',
        rulesetVersion: 2,
        options: { bestOf: 3 },
      });
    });

    it('prefers canonical configuration on the ended event', () => {
      const { result } = renderHook(() => useGameState(11));
      emit('game.started', { matchId: 8, gameType: 'rps', format: 'old', rulesetVersion: 1, options: {}, views: [] });
      emit('game.ended', { matchId: 8, gameType: 'rps', format: 'bo5', rulesetVersion: 3, options: { bestOf: 5 }, draw: true });
      expect(result.current.ended).toMatchObject({
        sourceMatchId: 8,
        format: 'bo5',
        rulesetVersion: 3,
        options: { bestOf: 5 },
      });
    });
  });

  describe('game.error', () => {
    // In the WebView client `gamesApi.invite` posts over the bridge and always
    // resolves, so a rejected challenge arrives as a `game.error` rather than a
    // rejected promise. The optimistic pending invite must be torn down here or
    // the "waiting for opponent" notification (with its Cancel button and
    // fallback countdown) stays on screen next to the error.
    it('clears the pending challenge when the server rejects the invite', () => {
      const { result } = renderHook(() => useGameState(11));

      act(() => result.current.invite(22, 'deathroll'));
      expect(result.current.outgoingInvite).not.toBeNull();

      emit('game.error', {
        command: 'game.invite', path: 'games/invite',
        error: 'A player is already committed.', statusCode: 400, reason: 'alreadyCommitted',
      });

      expect(result.current.outgoingInvite).toBeNull();
    });

    // "A player is already committed." is orchestrator vocabulary and renders as a
    // never-auto-dismissing error box. A busy opponent is a normal outcome of a
    // challenge, so route it through the friendly (auto-dismissing) outcome slot.
    it('reports a busy opponent as a friendly invite outcome, not an error', () => {
      const { result } = renderHook(() => useGameState(11));

      act(() => result.current.invite(22, 'deathroll'));

      emit('game.error', {
        command: 'game.invite', path: 'games/invite',
        error: 'A player is already committed.', statusCode: 400, reason: 'alreadyCommitted',
      });

      expect(result.current.inviteOutcome).toEqual({ kind: 'busy', targetSession: 22 });
      expect(result.current.lastError).toBeNull();
      expect(result.current.outgoingInvite).toBeNull();
    });

    it('still reports a non-busy invite failure as an error', () => {
      const { result } = renderHook(() => useGameState(11));

      act(() => result.current.invite(22, 'deathroll'));

      emit('game.error', {
        command: 'game.invite', path: 'games/invite',
        error: 'That game type is unavailable.', statusCode: 400, reason: 'unknownGameType',
      });

      expect(result.current.inviteOutcome).toBeNull();
      expect(result.current.lastError).toBe('That game type is unavailable.');
    });

    it('leaves the pending challenge intact when an unrelated command fails', () => {
      const { result } = renderHook(() => useGameState(11));

      emit('game.invitePending', { offerId: 7, target: 22, gameType: 'deathroll' });
      expect(result.current.outgoingInvite?.offerId).toBe(7);

      emit('game.error', {
        command: 'game.ready', path: 'games/ready',
        error: 'This ready check is no longer available.', statusCode: 400, reason: 'staleOffer',
        reservationId: 12,
      });

      expect(result.current.outgoingInvite?.offerId).toBe(7);
      // `game.ready` belongs to useDuelQueueState — see DUEL_QUEUE_OWNED_COMMANDS
      // and duelErrorOwnership.test.tsx. Reporting it here too would show two
      // persistent error notifications for one failure.
      expect(result.current.lastError).toBeNull();
    });

    // Cancelling before the server confirms the offer arms a deferred cancel that
    // fires on the next `game.invitePending`. If the challenge is then rejected,
    // that armed cancel must be disarmed or it cancels the user's NEXT challenge.
    it('disarms the deferred cancel so a later challenge survives', () => {
      const { result } = renderHook(() => useGameState(11));

      act(() => result.current.invite(22, 'deathroll'));
      act(() => result.current.cancelInvite());
      expect(result.current.outgoingInvite?.canceling).toBe(true);

      emit('game.error', {
        command: 'game.invite', path: 'games/invite',
        error: 'A player is already committed.', statusCode: 400, reason: 'alreadyCommitted',
      });

      act(() => result.current.invite(33, 'deathroll'));
      emit('game.invitePending', { offerId: 8, target: 33, gameType: 'deathroll' });

      expect(api.cancelOffer).not.toHaveBeenCalled();
      expect(result.current.outgoingInvite?.offerId).toBe(8);
      expect(result.current.outgoingInvite?.canceling).toBeFalsy();
    });
  });
});
