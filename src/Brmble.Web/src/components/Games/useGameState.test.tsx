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
});
