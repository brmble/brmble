namespace Brmble.Server.Games.Duels;

public sealed class DuelOrchestrator : IDuelOrchestrator
{
    private static readonly TimeSpan OfferLifetime = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(15);

    private readonly GameDefinitionCatalog _catalog;
    private readonly IGamePresence _presence;
    private readonly IGameEventPublisher _publisher;
    private readonly IDuelMatchRunnerRouter _runner;
    private readonly TimeProvider _timeProvider;
    private readonly object _gate = new();
    private readonly Dictionary<long, Offer> _offers = [];
    private readonly Dictionary<long, UserCommitment> _commitmentsByUserId = [];
    private readonly Dictionary<int, ChannelState> _channels = [];
    private readonly Dictionary<int, ChannelClock> _channelClocks = [];
    private long _nextOfferId;
    private long _nextReservationId;
    private long _nextAcceptanceSequence;

    public DuelOrchestrator(
        GameDefinitionCatalog catalog,
        IGamePresence presence,
        IGameEventPublisher publisher,
        IDuelMatchRunnerRouter runner,
        TimeProvider? timeProvider = null)
    {
        _catalog = catalog;
        _presence = presence;
        _publisher = publisher;
        _runner = runner;
        _timeProvider = timeProvider ?? TimeProvider.System;
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
            offer = new Offer(offerId, channelId, inviter, target, configuration, _timeProvider.GetUtcNow().Add(OfferLifetime));
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
                    _timeProvider.GetUtcNow(),
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
                Bump(offer.ChannelId, channel);
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

    public async Task<DuelCommandResult> RespondReadyAsync(long reservationId, long userId, ReadyResponse response)
    {
        ReadyCheck? removed = null;
        ReadyCheck? changed = null;
        DuelReservation? start = null;
        int channelId;
        lock (_gate)
        {
            var pair = _channels.Values.Select(x => x.ReadyCheck)
                .FirstOrDefault(x => x?.Reservation.ReservationId == reservationId);
            if (pair is null)
                return Reject("This ready check is no longer available.", DuelRejectReason.StaleOffer);
            channelId = pair.Reservation.ChannelId;
            var player = PlayerFor(pair.Reservation, userId);
            if (player is null)
                return Reject("Only a participant may respond.", DuelRejectReason.NotParticipant);
            if (!StillPresent(player, channelId))
                return Reject("The player is no longer present.", DuelRejectReason.NotPresent);

            var channel = _channels[channelId];
            if (response == ReadyResponse.Decline)
            {
                removed = RemoveReadyCheck(channel, pair);
                channel.Advancing = true;
                Bump(channelId, channel);
            }
            else if (pair.ReadyUserIds.Add(userId))
            {
                changed = pair;
                Bump(channelId, channel);
                if (pair.ReadyUserIds.Count == 2)
                {
                    removed = pair;
                    channel.ReadyCheck = null;
                    channel.Active = pair.Reservation;
                    channel.Advancing = true;
                    SetPairCommitment(pair.Reservation, DuelCommitmentKind.Active);
                    Bump(channelId, channel);
                    start = pair.Reservation;
                }
            }
        }

        removed?.Timer?.Dispose();
        if (response == ReadyResponse.Decline)
        {
            await PublishReservationCancellationAsync(removed!.Reservation, "declined");
            await AdvanceChannelAsync(channelId);
        }
        else
        {
            await PublishReadyBestEffortAsync(changed);
        }
        if (start is not null) return await StartAsync(0, start);
        return Success(null, reservationId);
    }

    public Task<DuelCommandResult> RequestRematchAsync(long sourceMatchId, long requesterUserId) =>
        Task.FromResult(Reject("Rematches are not available yet.", DuelRejectReason.StaleOffer));

    public Task<DuelQueueSnapshot> GetSnapshotForSessionAsync(long sessionId)
    {
        if (!TryResolvePlayer(sessionId, out _, out var channelId))
            return Task.FromResult(EmptySnapshot(0));

        lock (_gate)
        {
            if (!_channels.TryGetValue(channelId, out var channel))
            {
                var clock = GetClock(channelId);
                return Task.FromResult(EmptySnapshot(channelId, clock.Generation == 0 ? 1 : clock.Generation, clock.Revision));
            }
            var queue = channel.Queue.Select((reservation, index) => new QueuedDuelSnapshot(
                reservation.ReservationId,
                index + 1,
                Players(reservation),
                reservation.Configuration.GameType,
                reservation.Configuration.Format,
                reservation.Configuration.RulesetVersion,
                new QueueEtaSnapshot(EstimateStatus.Unknown, null, null, true, []))).ToArray();
            var ready = channel.ReadyCheck is null ? null : new ReadyCheckSnapshot(
                channel.ReadyCheck.Reservation.ReservationId,
                channel.ReadyCheck.ExpiresAt,
                Players(channel.ReadyCheck.Reservation, channel.ReadyCheck.ReadyUserIds),
                channel.ReadyCheck.Reservation.Configuration.GameType,
                channel.ReadyCheck.Reservation.Configuration.Format,
                channel.ReadyCheck.Reservation.Configuration.RulesetVersion);
            return Task.FromResult(new DuelQueueSnapshot(
                1, channel.Generation, channel.Revision, channelId, _timeProvider.GetUtcNow(), 0, null, ready, queue));
        }
    }

    public async Task HandlePresenceLostAsync(long userId, long oldSessionId, DuelCancelReason reason)
    {
        Offer[] canceled;
        List<DuelReservation> reservations = [];
        List<int> advanceChannels = [];
        DuelReservation? activeForfeitCandidate = null;
        lock (_gate)
        {
            canceled = _offers.Values
                .Where(x => HasPlayer(x, userId, oldSessionId))
                .ToArray();
            foreach (var offer in canceled) RemoveOffer(offer);

            if (_commitmentsByUserId.TryGetValue(userId, out var commitment))
            {
                foreach (var (channelId, channel) in _channels)
                {
                    if (channel.Active is not null && commitment.Kind == DuelCommitmentKind.Active
                        && channel.Active.ReservationId == commitment.Id
                        && PlayerFor(channel.Active, userId)?.SessionId == oldSessionId)
                    {
                        if (!channel.ForfeitedUserIds.Contains(userId)) activeForfeitCandidate = channel.Active;
                        break;
                    }

                    var queued = channel.Queue.ToArray();
                    var removedQueued = queued.FirstOrDefault(x => x.ReservationId == commitment.Id
                        && PlayerFor(x, userId)?.SessionId == oldSessionId);
                    if (removedQueued is not null)
                    {
                        channel.Queue.Clear();
                        foreach (var item in queued.Where(x => x.ReservationId != removedQueued.ReservationId))
                            channel.Queue.Enqueue(item);
                        ReleasePair(removedQueued);
                        reservations.Add(removedQueued);
                        Bump(channelId, channel);
                        if (channel.Active is null && channel.ReadyCheck is null) { channel.Advancing = true; advanceChannels.Add(channelId); }
                        break;
                    }
                    if (channel.ReadyCheck?.Reservation.ReservationId == commitment.Id
                        && PlayerFor(channel.ReadyCheck.Reservation, userId)?.SessionId == oldSessionId)
                    {
                        var removedReady = RemoveReadyCheck(channel, channel.ReadyCheck);
                        removedReady.Timer?.Dispose();
                        reservations.Add(removedReady.Reservation);
                        channel.Advancing = true;
                        Bump(channelId, channel);
                        advanceChannels.Add(channelId);
                        break;
                    }
                }
            }
        }
        foreach (var offer in canceled)
            await PublishCancellationBestEffortAsync(offer, CancelReason(reason));
        foreach (var reservation in reservations)
            await PublishReservationCancellationAsync(reservation, CancelReason(reason));
        if (activeForfeitCandidate is not null
            && _runner.TryGetActiveMatch(userId, out var forfeit)
            && forfeit.ReservationId == activeForfeitCandidate.ReservationId)
        {
            var ownsForfeit = false;
            lock (_gate)
            {
                if (_channels.TryGetValue(activeForfeitCandidate.ChannelId, out var channel)
                    && channel.Active?.ReservationId == activeForfeitCandidate.ReservationId)
                    ownsForfeit = channel.ForfeitedUserIds.Add(userId);
            }
            if (ownsForfeit) await _runner.ForfeitAsync(forfeit.MatchId, userId, CancelReason(reason));
        }
        foreach (var channelId in advanceChannels.Distinct())
            await AdvanceChannelAsync(channelId);
    }

    public async Task HandleChannelRemovedAsync(int channelId)
    {
        List<Offer> offers;
        List<DuelReservation> reservations = [];
        List<(DuelReservation Reservation, long UserId)> forfeitCandidates = [];
        ITimer? timer = null;
        lock (_gate)
        {
            offers = _offers.Values.Where(x => x.ChannelId == channelId).ToList();
            foreach (var offer in offers) RemoveOffer(offer);
            if (_channels.Remove(channelId, out var channel))
            {
                if (channel.ReadyCheck is not null) { timer = channel.ReadyCheck.Timer; reservations.Add(channel.ReadyCheck.Reservation); }
                reservations.AddRange(channel.Queue);
                if (channel.Active is not null)
                {
                    reservations.Add(channel.Active);
                    foreach (var userId in ParticipantIds(channel.Active))
                        forfeitCandidates.Add((channel.Active, userId));
                }
                foreach (var reservation in reservations) ReleasePair(reservation);
            }
            var clock = GetClock(channelId);
            clock.Generation++;
            clock.Revision++;
        }
        timer?.Dispose();
        foreach (var offer in offers) await PublishCancellationBestEffortAsync(offer, "channelRemoved");
        foreach (var reservation in reservations) await PublishReservationCancellationAsync(reservation, "channelRemoved");
        foreach (var item in forfeitCandidates)
            if (_runner.TryGetActiveMatch(item.UserId, out var active)
                && active.ReservationId == item.Reservation.ReservationId)
                await _runner.ForfeitAsync(active.MatchId, item.UserId, "channelRemoved");
    }

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
            if (_channels.TryGetValue(reservation.ChannelId, out var channel)
                && channel.Active?.ReservationId == reservation.ReservationId)
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
                Bump(reservation.ChannelId, channel);
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
            Bump(completion.ChannelId, channel);
        }
        if (needsAdvancement) await AdvanceChannelAsync(completion.ChannelId);
    }

    private async Task AdvanceChannelAsync(int channelId)
    {
        while (true)
        {
            ReadyCheck? promoted = null;
            DuelReservation? invalid = null;
            lock (_gate)
            {
                if (!_channels.TryGetValue(channelId, out var channel)) return;
                if (channel.Active is not null || channel.ReadyCheck is not null)
                {
                    channel.Advancing = false;
                    return;
                }
                if (channel.Queue.Count == 0)
                {
                    channel.Advancing = false;
                    return;
                }

                var candidate = channel.Queue.Dequeue();
                if (!StillPresent(candidate.PlayerOne, channelId) || !StillPresent(candidate.PlayerTwo, channelId))
                {
                    invalid = candidate;
                    ReleasePair(candidate);
                    Bump(channelId, channel);
                }
                else
                {
                    var clock = GetClock(channelId);
                    var generation = ++clock.ReadyGeneration;
                    promoted = new(candidate, _timeProvider.GetUtcNow().Add(ReadyTimeout), generation);
                    channel.ReadyCheck = promoted;
                    channel.Advancing = false;
                    SetPairCommitment(candidate, DuelCommitmentKind.ReadyCheck);
                    Bump(channelId, channel);
                    promoted.Timer = _timeProvider.CreateTimer(
                        _ => _ = ExpireReadyAsync(channelId, candidate.ReservationId, generation),
                        null, ReadyTimeout, Timeout.InfiniteTimeSpan);
                }
            }

            if (invalid is not null)
            {
                await PublishReservationCancellationAsync(invalid, "disconnected");
                continue;
            }
            await PublishReadyBestEffortAsync(promoted);
            return;
        }
    }

    private async Task ExpireReadyAsync(int channelId, long reservationId, long generation)
    {
        DuelReservation? reservation = null;
        lock (_gate)
        {
            if (!_channels.TryGetValue(channelId, out var channel)
                || channel.ReadyCheck is not { } ready
                || ready.Reservation.ReservationId != reservationId
                || ready.Generation != generation)
                return;
            reservation = RemoveReadyCheck(channel, ready).Reservation;
            channel.Advancing = true;
            Bump(channelId, channel);
        }
        await PublishReservationCancellationAsync(reservation, "expired");
        await AdvanceChannelAsync(channelId);
    }

    private async Task ExpireOfferAsync(long offerId, DateTimeOffset expiresAt)
    {
        await Task.Delay(expiresAt - _timeProvider.GetUtcNow(), _timeProvider);
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
        {
            var clock = GetClock(channelId);
            if (clock.Generation == 0) clock.Generation = 1;
            _channels.Add(channelId, channel = new() { Generation = clock.Generation, Revision = clock.Revision });
        }
        return channel;
    }

    private ChannelClock GetClock(int channelId)
    {
        if (!_channelClocks.TryGetValue(channelId, out var clock))
            _channelClocks.Add(channelId, clock = new());
        return clock;
    }

    private void Bump(int channelId, ChannelState channel)
    {
        channel.Revision++;
        var clock = GetClock(channelId);
        clock.Generation = channel.Generation;
        clock.Revision = channel.Revision;
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

    private ReadyCheck RemoveReadyCheck(ChannelState channel, ReadyCheck ready)
    {
        channel.ReadyCheck = null;
        ReleasePair(ready.Reservation);
        return ready;
    }

    private void RemoveCommitment(long userId, long id)
    {
        if (_commitmentsByUserId.TryGetValue(userId, out var commitment) && commitment.Id == id)
            _commitmentsByUserId.Remove(userId);
    }

    private static IReadOnlyList<DuelPlayerSnapshot> Players(
        DuelReservation reservation, IReadOnlySet<long>? readyUserIds = null) =>
        [new(reservation.PlayerOne.UserId, reservation.PlayerOne.SessionId, reservation.PlayerOne.DisplayName,
             readyUserIds?.Contains(reservation.PlayerOne.UserId) == true),
         new(reservation.PlayerTwo.UserId, reservation.PlayerTwo.SessionId, reservation.PlayerTwo.DisplayName,
             readyUserIds?.Contains(reservation.PlayerTwo.UserId) == true)];

    private static DuelPlayer? PlayerFor(DuelReservation reservation, long userId) =>
        reservation.PlayerOne.UserId == userId ? reservation.PlayerOne
        : reservation.PlayerTwo.UserId == userId ? reservation.PlayerTwo : null;

    private static bool HasPlayer(Offer offer, long userId, long sessionId) =>
        (offer.Inviter.UserId == userId && offer.Inviter.SessionId == sessionId)
        || (offer.Target.UserId == userId && offer.Target.SessionId == sessionId);

    private Task PublishReservationCancellationAsync(DuelReservation reservation, string reason) =>
        PublishBestEffortAsync(ParticipantIds(reservation), new
        {
            type = "game.commitmentCanceled",
            reservationId = reservation.ReservationId,
            reason,
        });

    private Task PublishReadyBestEffortAsync(ReadyCheck? ready) => ready is null
        ? Task.CompletedTask
        : PublishBestEffortAsync(ParticipantIds(ready.Reservation), new
        {
            type = "game.readyCheck",
            reservationId = ready.Reservation.ReservationId,
            expiresAt = ready.ExpiresAt,
            readyMs = (int)ReadyTimeout.TotalMilliseconds,
            readyUserIds = ready.ReadyUserIds.ToArray(),
        });

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

    private static DuelQueueSnapshot EmptySnapshot(int channelId, long generation = 1, long revision = 0) =>
        new(1, generation, revision, channelId, DateTimeOffset.UtcNow, 0, null, null, []);

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
        public ReadyCheck? ReadyCheck { get; set; }
        public bool Advancing;
        public long Generation;
        public long Revision;
        public HashSet<long> ForfeitedUserIds { get; } = [];
    }

    private sealed class ReadyCheck(DuelReservation reservation, DateTimeOffset expiresAt, long generation)
    {
        public DuelReservation Reservation { get; } = reservation;
        public DateTimeOffset ExpiresAt { get; } = expiresAt;
        public long Generation { get; } = generation;
        public HashSet<long> ReadyUserIds { get; } = [];
        public ITimer? Timer { get; set; }
    }

    private sealed class ChannelClock
    {
        public long Generation;
        public long Revision;
        public long ReadyGeneration;
    }
}
