namespace Brmble.Server.Games.Duels;

public sealed class DuelOrchestrator : IDuelOrchestrator
{
    private static readonly TimeSpan OfferLifetime = TimeSpan.FromSeconds(30);

    private readonly GameDefinitionCatalog _catalog;
    private readonly IGamePresence _presence;
    private readonly IGameEventPublisher _publisher;
    private readonly IDuelMatchRunnerRouter _runner;
    private readonly object _gate = new();
    private readonly Dictionary<long, Offer> _offers = [];
    private readonly Dictionary<long, UserCommitment> _commitmentsByUserId = [];
    private readonly Dictionary<int, ChannelState> _channels = [];
    private long _nextOfferId;
    private long _nextReservationId;
    private long _nextAcceptanceSequence;

    public DuelOrchestrator(
        GameDefinitionCatalog catalog,
        IGamePresence presence,
        IGameEventPublisher publisher,
        IDuelMatchRunnerRouter runner)
    {
        _catalog = catalog;
        _presence = presence;
        _publisher = publisher;
        _runner = runner;
        _runner.MatchCompleted += OnMatchCompletedAsync;
    }

    public async Task<DuelCommandResult> CreateChallengeAsync(
        long inviterSessionId,
        long targetSessionId,
        string gameType,
        IReadOnlyDictionary<string, object?>? options)
    {
        DuelConfiguration configuration;
        try
        {
            configuration = _catalog.Create(gameType, options);
        }
        catch (InvalidGameConfigurationException ex)
        {
            return Reject(ex.Message, DuelRejectReason.InvalidConfiguration);
        }

        if (!TryResolvePlayer(inviterSessionId, out var inviter, out var channelId)
            || !TryResolvePlayer(targetSessionId, out var target, out var targetChannel)
            || inviter.UserId == target.UserId
            || channelId != targetChannel)
            return Reject("Both players must be connected to Brmble in the same channel.", DuelRejectReason.NotPresent);

        if (await _presence.AreChallengesBlockedAsync(targetSessionId))
            return Reject("This player isn't accepting challenges.", DuelRejectReason.Blocked);

        Offer offer;
        lock (_gate)
        {
            if (!StillPresent(inviter, channelId) || !StillPresent(target, channelId))
                return Reject("A player is no longer available.", DuelRejectReason.NotPresent);
            if (_commitmentsByUserId.ContainsKey(inviter.UserId)
                || _commitmentsByUserId.ContainsKey(target.UserId))
                return Reject("A player is already committed.", DuelRejectReason.AlreadyCommitted);

            var offerId = ++_nextOfferId;
            offer = new Offer(offerId, channelId, inviter, target, configuration, DateTimeOffset.UtcNow.Add(OfferLifetime));
            _offers.Add(offerId, offer);
            _commitmentsByUserId.Add(inviter.UserId, new(DuelCommitmentKind.Challenge, offerId));
            _commitmentsByUserId.Add(target.UserId, new(DuelCommitmentKind.Challenge, offerId));
        }

        try
        {
            await _publisher.PublishToUsersAsync(new HashSet<long> { inviter.UserId }, new
            {
                type = "game.invitePending", offerId = offer.Id, matchId = offer.Id,
                gameType = configuration.GameType, target = target.SessionId,
                inviteMs = (int)OfferLifetime.TotalMilliseconds,
            });
            await _publisher.PublishToUsersAsync(new HashSet<long> { target.UserId }, new
            {
                type = "game.invited", offerId = offer.Id, matchId = offer.Id,
                gameType = configuration.GameType, from = inviter.SessionId,
                inviteMs = (int)OfferLifetime.TotalMilliseconds,
            });
        }
        catch
        {
            var removed = false;
            lock (_gate)
            {
                if (_offers.TryGetValue(offer.Id, out var current) && ReferenceEquals(current, offer))
                {
                    RemoveOffer(offer);
                    removed = true;
                }
            }
            if (removed) await PublishCancellationBestEffortAsync(offer, "expired");
            return Reject("The challenge could not be delivered.", DuelRejectReason.NotPresent);
        }

        _ = ExpireOfferAsync(offer.Id, offer.ExpiresAt);
        return Success(offer.Id, null);
    }

    public async Task<DuelCommandResult> RespondToOfferAsync(long offerId, long responderUserId, bool accept)
    {
        Offer offer;
        DuelReservation? immediate = null;
        long? acceptedReservationId = null;
        lock (_gate)
        {
            if (!_offers.TryGetValue(offerId, out offer!))
                return Reject("This offer is no longer available.", DuelRejectReason.StaleOffer);
            if (offer.Target.UserId != responderUserId)
                return Reject("Only the challenged player may respond.", DuelRejectReason.NotParticipant);
            if (!StillPresent(offer.Inviter, offer.ChannelId) || !StillPresent(offer.Target, offer.ChannelId))
            {
                RemoveOffer(offer);
                return Reject("A player is no longer available.", DuelRejectReason.NotPresent);
            }

            if (!accept)
            {
                RemoveOffer(offer);
            }
            else
            {
                _offers.Remove(offer.Id);
                var reservationId = ++_nextReservationId;
                if (reservationId == offer.Id) reservationId = ++_nextReservationId;
                var reservation = new DuelReservation(
                    reservationId,
                    offer.ChannelId,
                    offer.Inviter,
                    offer.Target,
                    offer.Configuration,
                    DateTimeOffset.UtcNow,
                    ++_nextAcceptanceSequence,
                    null);
                acceptedReservationId = reservation.ReservationId;
                SetPairCommitment(reservation, DuelCommitmentKind.Queued);
                var channel = GetChannel(offer.ChannelId);
                if (channel.Active is null && channel.ReadyCheck is null && channel.Queue.Count == 0 && !channel.Advancing)
                {
                    channel.Advancing = true;
                    channel.Active = reservation;
                    SetPairCommitment(reservation, DuelCommitmentKind.Active);
                    immediate = reservation;
                }
                else
                {
                    channel.Queue.Enqueue(reservation);
                }
                channel.Revision++;
            }
        }

        await PublishBestEffortAsync(ParticipantIds(offer), new
        {
            type = accept ? "game.accepted" : "game.declined",
            offerId,
            matchId = offerId,
        });

        if (!accept) return Success(offerId, null);
        if (immediate is null) return Success(offerId, acceptedReservationId);
        return await StartAsync(offerId, immediate);
    }

    public async Task<DuelCommandResult> CancelOfferAsync(long offerId, long requesterUserId)
    {
        Offer offer;
        lock (_gate)
        {
            if (!_offers.TryGetValue(offerId, out offer!))
                return Reject("This offer is no longer available.", DuelRejectReason.StaleOffer);
            if (offer.Inviter.UserId != requesterUserId && offer.Target.UserId != requesterUserId)
                return Reject("Only a participant may cancel this offer.", DuelRejectReason.NotParticipant);
            RemoveOffer(offer);
        }
        await PublishCancellationAsync(offer,
            requesterUserId == offer.Inviter.UserId ? "expired" : "declined");
        return Success(offerId, null);
    }

    public Task<DuelCommandResult> RespondReadyAsync(long reservationId, long userId, ReadyResponse response) =>
        Task.FromResult(Reject("Ready checks are not available yet.", DuelRejectReason.StaleOffer));

    public Task<DuelCommandResult> RequestRematchAsync(long sourceMatchId, long requesterUserId) =>
        Task.FromResult(Reject("Rematches are not available yet.", DuelRejectReason.StaleOffer));

    public Task<DuelQueueSnapshot> GetSnapshotForSessionAsync(long sessionId)
    {
        if (!TryResolvePlayer(sessionId, out _, out var channelId))
            return Task.FromResult(EmptySnapshot(0));

        lock (_gate)
        {
            if (!_channels.TryGetValue(channelId, out var channel))
                return Task.FromResult(EmptySnapshot(channelId));
            var queue = channel.Queue.Select((reservation, index) => new QueuedDuelSnapshot(
                reservation.ReservationId,
                index + 1,
                Players(reservation),
                reservation.Configuration.GameType,
                reservation.Configuration.Format,
                reservation.Configuration.RulesetVersion,
                new QueueEtaSnapshot(EstimateStatus.Unknown, null, null, true, []))).ToArray();
            return Task.FromResult(new DuelQueueSnapshot(
                1, 1, channel.Revision, channelId, DateTimeOffset.UtcNow, 0, null, null, queue));
        }
    }

    public async Task HandlePresenceLostAsync(long userId, long oldSessionId, DuelCancelReason reason)
    {
        Offer[] canceled;
        lock (_gate)
        {
            canceled = _offers.Values
                .Where(x => x.Inviter.UserId == userId || x.Target.UserId == userId)
                .ToArray();
            foreach (var offer in canceled) RemoveOffer(offer);
        }
        foreach (var offer in canceled)
            await PublishCancellationAsync(offer, CancelReason(reason));
    }

    public Task HandleChannelRemovedAsync(int channelId) => Task.CompletedTask;

    private async Task<DuelCommandResult> StartAsync(long offerId, DuelReservation reservation)
    {
        GameStartResult result;
        try
        {
            result = await _runner.StartAsync(reservation);
        }
        catch (Exception ex)
        {
            result = new(false, 0, null, ex.Message);
        }

        var ownedTransition = false;
        var needsAdvancement = false;
        lock (_gate)
        {
            var channel = GetChannel(reservation.ChannelId);
            if (channel.Active?.ReservationId == reservation.ReservationId)
            {
                ownedTransition = true;
                if (!result.Success)
                {
                    channel.Active = null;
                    ReleasePair(reservation);
                    channel.Advancing = true;
                    needsAdvancement = true;
                }
                else channel.Advancing = false;
                channel.Revision++;
            }
        }

        if (!ownedTransition)
            return new(false, offerId, reservation.ReservationId,
                "The match completed during startup.", DuelRejectReason.NotPresent);
        if (result.Success) return Success(offerId, reservation.ReservationId);

        await PublishBestEffortAsync(ParticipantIds(reservation), new
        {
            type = "game.commitmentCanceled",
            reservationId = reservation.ReservationId,
            reason = "startFailed",
        });
        if (needsAdvancement) await AdvanceChannelAsync(reservation.ChannelId);
        return new(false, offerId, reservation.ReservationId,
            result.Error ?? "The match could not be started.", DuelRejectReason.NotPresent);
    }

    private async Task OnMatchCompletedAsync(MatchCompletion completion)
    {
        var needsAdvancement = false;
        lock (_gate)
        {
            if (!_channels.TryGetValue(completion.ChannelId, out var channel)
                || channel.Active?.ReservationId != completion.ReservationId)
                return;
            channel.Advancing = true;
            ReleasePair(channel.Active);
            channel.Active = null;
            needsAdvancement = true;
            channel.Revision++;
        }
        if (needsAdvancement) await AdvanceChannelAsync(completion.ChannelId);
    }

    // Task 6 replaces this boundary with ready-check promotion. Until then, a queued
    // pair keeps the channel occupied and no waited pair is started directly.
    private Task AdvanceChannelAsync(int channelId)
    {
        lock (_gate)
        {
            var channel = GetChannel(channelId);
            channel.Advancing = channel.Queue.Count > 0;
        }
        return Task.CompletedTask;
    }

    private async Task ExpireOfferAsync(long offerId, DateTimeOffset expiresAt)
    {
        await Task.Delay(expiresAt - DateTimeOffset.UtcNow);
        Offer? offer = null;
        lock (_gate)
        {
            if (_offers.TryGetValue(offerId, out var current) && current.ExpiresAt == expiresAt)
            {
                offer = current;
                RemoveOffer(current);
            }
        }
        if (offer is not null) await PublishCancellationAsync(offer, "expired");
    }

    private Task PublishCancellationAsync(Offer offer, string reason) =>
        _publisher.PublishToUsersAsync(ParticipantIds(offer), new
        {
            type = reason == "declined" ? "game.declined" : "game.expired",
            offerId = offer.Id,
            matchId = offer.Id,
            reason,
        });

    private async Task PublishCancellationBestEffortAsync(Offer offer, string reason)
    {
        try { await PublishCancellationAsync(offer, reason); }
        catch { }
    }

    private async Task PublishBestEffortAsync(IReadOnlySet<long> userIds, object message)
    {
        try
        {
            await _publisher.PublishToUsersAsync(userIds, message);
        }
        catch
        {
            // Delivery is advisory; authoritative lifecycle progression must continue.
        }
    }

    private bool TryResolvePlayer(long sessionId, out DuelPlayer player, out int channelId)
    {
        if (_presence.TryGetChannel(sessionId, out channelId, out var isBrmble, out var userId) && isBrmble)
        {
            player = new(sessionId, userId, _presence.GetDisplayName(sessionId) ?? $"user {userId}");
            return true;
        }
        player = null!;
        return false;
    }

    private bool StillPresent(DuelPlayer player, int channelId) =>
        _presence.TryGetChannel(player.SessionId, out var currentChannel, out var isBrmble, out var userId)
        && isBrmble && currentChannel == channelId && userId == player.UserId;

    private ChannelState GetChannel(int channelId)
    {
        if (!_channels.TryGetValue(channelId, out var channel))
            _channels.Add(channelId, channel = new());
        return channel;
    }

    private void RemoveOffer(Offer offer)
    {
        if (!_offers.Remove(offer.Id)) return;
        RemoveCommitment(offer.Inviter.UserId, offer.Id);
        RemoveCommitment(offer.Target.UserId, offer.Id);
    }

    private void SetPairCommitment(DuelReservation reservation, DuelCommitmentKind kind)
    {
        _commitmentsByUserId[reservation.PlayerOne.UserId] = new(kind, reservation.ReservationId);
        _commitmentsByUserId[reservation.PlayerTwo.UserId] = new(kind, reservation.ReservationId);
    }

    private void ReleasePair(DuelReservation reservation)
    {
        RemoveCommitment(reservation.PlayerOne.UserId, reservation.ReservationId);
        RemoveCommitment(reservation.PlayerTwo.UserId, reservation.ReservationId);
    }

    private void RemoveCommitment(long userId, long id)
    {
        if (_commitmentsByUserId.TryGetValue(userId, out var commitment) && commitment.Id == id)
            _commitmentsByUserId.Remove(userId);
    }

    private static IReadOnlyList<DuelPlayerSnapshot> Players(DuelReservation reservation) =>
        [new(reservation.PlayerOne.UserId, reservation.PlayerOne.SessionId, reservation.PlayerOne.DisplayName),
         new(reservation.PlayerTwo.UserId, reservation.PlayerTwo.SessionId, reservation.PlayerTwo.DisplayName)];

    private static IReadOnlySet<long> ParticipantIds(Offer offer) =>
        new HashSet<long> { offer.Inviter.UserId, offer.Target.UserId };

    private static IReadOnlySet<long> ParticipantIds(DuelReservation reservation) =>
        new HashSet<long> { reservation.PlayerOne.UserId, reservation.PlayerTwo.UserId };

    private static DuelCommandResult Success(long? offerId, long? reservationId) =>
        new(true, offerId, reservationId, null, DuelRejectReason.None);

    private static DuelCommandResult Reject(string error, DuelRejectReason reason) =>
        new(false, null, null, error, reason);

    private static string CancelReason(DuelCancelReason reason) => reason switch
    {
        DuelCancelReason.LeftChannel => "leftChannel",
        DuelCancelReason.ChannelRemoved => "channelRemoved",
        _ => "disconnected",
    };

    private static DuelQueueSnapshot EmptySnapshot(int channelId) =>
        new(1, 1, 0, channelId, DateTimeOffset.UtcNow, 0, null, null, []);

    private sealed record Offer(
        long Id,
        int ChannelId,
        DuelPlayer Inviter,
        DuelPlayer Target,
        DuelConfiguration Configuration,
        DateTimeOffset ExpiresAt);

    private sealed record UserCommitment(DuelCommitmentKind Kind, long Id);

    private sealed class ChannelState
    {
        public DuelReservation? Active;
        public Queue<DuelReservation> Queue { get; } = [];
        public object? ReadyCheck { get; set; }
        public bool Advancing;
        public long Revision;
    }
}
