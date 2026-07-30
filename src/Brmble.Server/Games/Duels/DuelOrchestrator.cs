namespace Brmble.Server.Games.Duels;

using System.Collections.ObjectModel;
using System.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

public sealed class DuelOrchestrator : IDuelOrchestrator, IDuelSnapshotProvider, IAsyncDisposable
{
    private static readonly TimeSpan OfferLifetime = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan CompletedSourceLifetime = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan SnapshotRetryDelay = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan ForfeitRetryDelay = TimeSpan.FromSeconds(1);
    private const int ForfeitAttemptLimit = 3;
    private const int SnapshotPublicationAttemptLimit = 5;
    private const int CompletedSourceLimit = 1000;

    private readonly GameDefinitionCatalog _catalog;
    private readonly IGamePresence _presence;
    private readonly IGameEventPublisher _publisher;
    private readonly IDuelMatchRunnerRouter _runner;
    private readonly DuelDurationEstimator? _estimator;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<DuelOrchestrator> _logger;
    private readonly object _gate = new();
    private readonly Dictionary<long, Offer> _offers = [];
    private readonly Dictionary<long, RematchTerminalOutcome> _rematchOutcomes = [];
    private readonly Queue<long> _rematchOutcomeOrder = [];
    private readonly Dictionary<long, UserCommitment> _commitmentsByUserId = [];
    private readonly Dictionary<int, ChannelState> _channels = [];
    private readonly Dictionary<int, ChannelClock> _channelClocks = [];
    private readonly Dictionary<int, SnapshotLane> _snapshotLanes = [];
    private readonly Dictionary<long, CompletedDuelSource> _completedSources = [];
    private readonly LinkedList<CompletedDuelSource> _completedSourceOrder = [];
    private readonly Dictionary<long, LinkedListNode<CompletedDuelSource>> _completedSourceNodes = [];
    private long _nextOfferId;
    private long _nextReservationId;
    private long _nextAcceptanceSequence;
    private bool _disposed;

    public DuelOrchestrator(
        GameDefinitionCatalog catalog,
        IGamePresence presence,
        IGameEventPublisher publisher,
        IDuelMatchRunnerRouter runner,
        TimeProvider? timeProvider = null)
        : this(catalog, presence, publisher, runner, null, timeProvider)
    {
    }

    public DuelOrchestrator(
        GameDefinitionCatalog catalog,
        IGamePresence presence,
        IGameEventPublisher publisher,
        IDuelMatchRunnerRouter runner,
        DuelDurationEstimator? estimator,
        TimeProvider? timeProvider = null,
        ILogger<DuelOrchestrator>? logger = null)
    {
        _catalog = catalog;
        _presence = presence;
        _publisher = publisher;
        _runner = runner;
        _estimator = estimator;
        _timeProvider = timeProvider ?? TimeProvider.System;
        _logger = logger ?? NullLogger<DuelOrchestrator>.Instance;
        _runner.MatchCompleted += OnMatchCompletedAsync;
    }

    public async ValueTask DisposeAsync()
    {
        List<ITimer> timers = [];
        List<Task> workers = [];
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var offer in _offers.Values)
            {
                if (offer.Timer is { } offerTimer) timers.Add(offerTimer);
                offer.Timer = null;
            }
            foreach (var channel in _channels.Values)
            {
                if (channel.ReadyCheck?.Timer is not { } readyTimer) continue;
                timers.Add(readyTimer);
                channel.ReadyCheck.Timer = null;
            }
            foreach (var lane in _snapshotLanes.Values)
                if (lane.Worker is { } worker) workers.Add(worker);
        }

        _runner.MatchCompleted -= OnMatchCompletedAsync;
        foreach (var timer in timers) timer.Dispose();
        foreach (var worker in workers)
        {
            try { await worker; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Duel snapshot worker faulted during orchestrator disposal");
            }
        }
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
            offer = new Offer(offerId, channelId, inviter, target, configuration,
                _timeProvider.GetUtcNow().Add(OfferLifetime), null);
            _offers.Add(offerId, offer);
            _commitmentsByUserId.Add(inviter.UserId, new(DuelCommitmentKind.Challenge, offerId));
            _commitmentsByUserId.Add(target.UserId, new(DuelCommitmentKind.Challenge, offerId));
            offer.Timer = _timeProvider.CreateTimer(
                _ => _ = ExpireOfferAsync(offer.Id, offer.ExpiresAt),
                null, OfferLifetime, Timeout.InfiniteTimeSpan);
        }

        try
        {
            await _publisher.PublishToUsersAsync(new HashSet<long> { inviter.UserId }, new
            {
                type = "game.invitePending", offerId = offer.Id,
                gameType = configuration.GameType, target = target.SessionId,
                inviteMs = (int)OfferLifetime.TotalMilliseconds,
            });
            await _publisher.PublishToUsersAsync(new HashSet<long> { target.UserId }, new
            {
                type = "game.invited", offerId = offer.Id,
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

        return Success(offer.Id, null);
    }

    public async Task<DuelCommandResult> RespondToOfferAsync(long offerId, long responderUserId, bool accept)
    {
        Offer offer;
        StartDecision? immediate = null;
        long? acceptedReservationId = null;
        var unavailable = false;
        var deferOfferResponse = false;
        lock (_gate)
        {
            if (!_offers.TryGetValue(offerId, out offer!))
                return Reject("This offer is no longer available.", DuelRejectReason.StaleOffer);
            if (offer.Target.UserId != responderUserId)
                return Reject("Only the challenged player may respond.", DuelRejectReason.NotParticipant);
            if (!StillPresent(offer.Inviter, offer.ChannelId) || !StillPresent(offer.Target, offer.ChannelId))
            {
                RemoveOffer(offer, "notPresent");
                unavailable = true;
                goto OfferDecisionComplete;
            }

            if (!accept)
            {
                RemoveOffer(offer, "declined");
            }
            else
            {
                RemoveOffer(offer);
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
                    offer.SourceMatchId);
                offer.AcceptedReservationId = reservation.ReservationId;
                RecordRematchOutcome(offer, RematchTerminalKind.Accepted, "accepted");
                acceptedReservationId = reservation.ReservationId;
                SetPairCommitment(reservation, DuelCommitmentKind.Queued);
                var channel = GetChannel(offer.ChannelId);
                if (channel.Active is null && channel.ReadyCheck is null && channel.Queue.Count == 0 && !channel.Advancing)
                {
                    channel.Advancing = true;
                    channel.Starting = new StartToken(reservation, ++channel.NextStartGeneration);
                    SetPairCommitment(reservation, DuelCommitmentKind.Active);
                    immediate = new(channel.Starting);
                }
                else
                {
                    channel.Queue.Enqueue(reservation);
                }
                Bump(offer.ChannelId, channel);
            }
        OfferDecisionComplete:
            // A rematch offer with publication stages still in flight has recorded a terminal
            // outcome; FinalizeRematchPublicationStageAsync is then the single publisher for it.
            deferOfferResponse = offer.SourceMatchId is not null && offer.OutstandingPublicationStages > 0;
        }

        if (unavailable)
        {
            await PublishCancellationBestEffortAsync(offer, "notPresent");
            return Reject("A player is no longer available.", DuelRejectReason.NotPresent);
        }
        if (!deferOfferResponse) await PublishOfferResponseBestEffortAsync(offer, accept);

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
            if (offer.Inviter.UserId != requesterUserId)
                return Reject("Only the offer requester may cancel this offer.", DuelRejectReason.NotParticipant);
            RemoveOffer(offer, "expired");
        }
        await PublishCancellationAsync(offer, "expired");
        return Success(offerId, null);
    }

    public async Task<DuelCommandResult> RespondReadyAsync(long reservationId, long userId, ReadyResponse response)
    {
        ReadyCheck? removed = null;
        ReadyCheck? changed = null;
        StartDecision? start = null;
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
                if (pair.ReadyUserIds.Count == 2)
                {
                    if (!StillPresent(pair.Reservation.PlayerOne, channelId)
                        || !StillPresent(pair.Reservation.PlayerTwo, channelId))
                    {
                        removed = RemoveReadyCheck(channel, pair);
                        channel.Advancing = true;
                        Bump(channelId, channel);
                        goto ReadyDecisionComplete;
                    }
                    removed = pair;
                    channel.ReadyCheck = null;
                    channel.Starting = new StartToken(pair.Reservation, ++channel.NextStartGeneration);
                    channel.Advancing = true;
                    SetPairCommitment(pair.Reservation, DuelCommitmentKind.Active);
                    Bump(channelId, channel);
                    start = new(channel.Starting);
                }
                else
                {
                    Bump(channelId, channel);
                }
            }
        ReadyDecisionComplete:;
        }

        removed?.Timer?.Dispose();
        if (response == ReadyResponse.Decline || removed is not null && start is null)
        {
            var reason = response == ReadyResponse.Decline ? "declined" : "disconnected";
            await PublishReservationCancellationAsync(removed!.Reservation, reason);
            await AdvanceChannelAsync(channelId);
            if (response != ReadyResponse.Decline)
                return Reject("A player is no longer present.", DuelRejectReason.NotPresent);
        }
        else
        {
            await PublishReadyBestEffortAsync(changed);
        }
        if (start is not null) return await StartAsync(0, start);
        return Success(null, reservationId);
    }

    public async Task<DuelCommandResult> RequestRematchAsync(long sourceMatchId, long requesterUserId)
    {
        Offer offer;
        lock (_gate)
        {
            PruneCompletedSources();
            if (!_completedSources.TryGetValue(sourceMatchId, out var source))
                return Reject("This completed match is no longer available.", DuelRejectReason.StaleOffer);
            if (source.PlayerOne.UserId != requesterUserId && source.PlayerTwo.UserId != requesterUserId)
                return Reject("Only a participant may request a rematch.", DuelRejectReason.NotParticipant);
            if (!StillPresent(source.PlayerOne, source.ChannelId)
                || !StillPresent(source.PlayerTwo, source.ChannelId))
                return Reject("A player is no longer available.", DuelRejectReason.NotPresent);
            if (_commitmentsByUserId.ContainsKey(source.PlayerOne.UserId)
                || _commitmentsByUserId.ContainsKey(source.PlayerTwo.UserId))
                return Reject("A player is already committed.", DuelRejectReason.AlreadyCommitted);

            var requester = source.PlayerOne.UserId == requesterUserId ? source.PlayerOne : source.PlayerTwo;
            var target = source.PlayerOne.UserId == requesterUserId ? source.PlayerTwo : source.PlayerOne;
            var offerId = ++_nextOfferId;
            offer = new Offer(offerId, source.ChannelId, requester, target, source.Configuration,
                _timeProvider.GetUtcNow().Add(OfferLifetime), sourceMatchId);
            _offers.Add(offerId, offer);
            _commitmentsByUserId.Add(requester.UserId, new(DuelCommitmentKind.RematchOffer, offerId));
            _commitmentsByUserId.Add(target.UserId, new(DuelCommitmentKind.RematchOffer, offerId));
            offer.Timer = _timeProvider.CreateTimer(
                _ => _ = ExpireOfferAsync(offer.Id, offer.ExpiresAt),
                null, OfferLifetime, Timeout.InfiniteTimeSpan);
        }

        try
        {
            await _publisher.PublishToUsersAsync(new HashSet<long> { offer.Inviter.UserId }, RematchMessage(
                "game.rematchPending", offer, offer.Target.UserId));
            var pendingTransition = await FinalizeRematchPublicationStageAsync(offer);
            if (pendingTransition is not null) return pendingTransition;
            await _publisher.PublishToUsersAsync(new HashSet<long> { offer.Target.UserId }, RematchMessage(
                "game.rematchOffered", offer, offer.Target.UserId));
        }
        catch
        {
            lock (_gate)
            {
                if (OwnsOffer(offer))
                    RemoveOffer(offer, "deliveryFailed");
            }
            return await FinalizeRematchPublicationStageAsync(offer)
                ?? Reject("The rematch offer could not be delivered.", DuelRejectReason.NotPresent);
        }

        var offeredTransition = await FinalizeRematchPublicationStageAsync(offer);
        if (offeredTransition is not null) return offeredTransition;
        return Success(offer.Id, null);
    }

    public async Task<DuelQueueSnapshot> GetSnapshotForSessionAsync(long sessionId)
    {
        if (!TryResolvePlayer(sessionId, out _, out var channelId))
            return EmptySnapshot(0, 0, 0, _timeProvider.GetUtcNow());

        ChannelSnapshotInput input;
        lock (_gate)
        {
            input = CaptureSnapshotInput(channelId);
        }
        return await BuildSnapshotAsync(input);
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
            foreach (var offer in canceled) RemoveOffer(offer, CancelReason(reason));

            if (_commitmentsByUserId.TryGetValue(userId, out var commitment))
            {
                foreach (var (channelId, channel) in _channels)
                {
                    if (channel.Starting is not null && commitment.Kind == DuelCommitmentKind.Active
                        && channel.Starting.Reservation.ReservationId == commitment.Id
                        && PlayerFor(channel.Starting.Reservation, userId)?.SessionId == oldSessionId)
                    {
                        channel.Starting.CancellationReason = CancelReason(reason);
                        reservations.Add(channel.Starting.Reservation);
                        ReleasePair(channel.Starting.Reservation);
                        channel.Starting = null;
                        channel.Advancing = true;
                        Bump(channelId, channel);
                        advanceChannels.Add(channelId);
                        break;
                    }
                    if (channel.Active is not null && commitment.Kind == DuelCommitmentKind.Active
                        && channel.Active.ReservationId == commitment.Id
                        && PlayerFor(channel.Active, userId)?.SessionId == oldSessionId)
                    {
                        activeForfeitCandidate = channel.Active;
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
                        if (channel.Active is null && channel.Starting is null && channel.ReadyCheck is null) { channel.Advancing = true; advanceChannels.Add(channelId); }
                        break;
                    }
                    if (channel.ReadyCheck?.Reservation.ReservationId == commitment.Id
                        && PlayerFor(channel.ReadyCheck.Reservation, userId)?.SessionId == oldSessionId)
                    {
                        var removedReady = RemoveReadyCheck(channel, channel.ReadyCheck);
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
            var token = new ActiveForfeitToken(activeForfeitCandidate.ReservationId, userId);
            var ownsForfeit = false;
            lock (_gate)
            {
                if (_channels.TryGetValue(activeForfeitCandidate.ChannelId, out var channel)
                    && channel.Active?.ReservationId == activeForfeitCandidate.ReservationId)
                    ownsForfeit = channel.ActiveForfeits.Add(token);
            }
            if (ownsForfeit)
                _ = Task.Run(() => RunActiveForfeitAsync(
                    activeForfeitCandidate.ChannelId, token, forfeit.MatchId, CancelReason(reason)));
        }
        foreach (var channelId in advanceChannels.Distinct())
        {
            await AdvanceChannelAsync(channelId);
        }
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
            foreach (var offer in offers) RemoveOffer(offer, "channelRemoved");
            foreach (var source in _completedSources.Values.Where(x => x.ChannelId == channelId).ToArray())
                RemoveCompletedSource(source.MatchId);
            if (_channels.Remove(channelId, out var channel))
            {
                if (channel.ReadyCheck is not null) { timer = channel.ReadyCheck.Timer; reservations.Add(channel.ReadyCheck.Reservation); }
                reservations.AddRange(channel.Queue);
                if (channel.Starting is not null)
                {
                    channel.Starting.CancellationReason = "channelRemoved";
                    reservations.Add(channel.Starting.Reservation);
                }
                if (channel.Active is not null)
                {
                    reservations.Add(channel.Active);
                    foreach (var userId in ParticipantIds(channel.Active))
                        forfeitCandidates.Add((channel.Active, userId));
                }
                foreach (var reservation in reservations) ReleasePair(reservation);
            }
            if (!_channelClocks.TryGetValue(channelId, out var clock))
                _channelClocks.Add(channelId, clock = new());
            clock.Generation++;
            clock.Revision++;
            EnqueueSnapshotPublication(channelId);
        }
        timer?.Dispose();
        foreach (var offer in offers) await PublishCancellationBestEffortAsync(offer, "channelRemoved");
        foreach (var reservation in reservations) await PublishReservationCancellationAsync(reservation, "channelRemoved");
        foreach (var item in forfeitCandidates)
            if (_runner.TryGetActiveMatch(item.UserId, out var active)
                && active.ReservationId == item.Reservation.ReservationId)
                await _runner.ForfeitAsync(active.MatchId, item.UserId, "channelRemoved");
    }

    private async Task RunActiveForfeitAsync(
        int channelId, ActiveForfeitToken token, long matchId, string reason)
    {
        for (var attempt = 1; attempt <= ForfeitAttemptLimit; attempt++)
        {
            lock (_gate)
            {
                if (!_channels.TryGetValue(channelId, out var channel)
                    || channel.Active?.ReservationId != token.ReservationId
                    || !channel.ActiveForfeits.Contains(token))
                    return;
            }

            try
            {
                await _runner.ForfeitAsync(matchId, token.UserId, reason);
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Failed to forfeit duel reservation {ReservationId} for user {UserId} on attempt {Attempt}",
                    token.ReservationId, token.UserId, attempt);
                if (attempt < ForfeitAttemptLimit)
                    await Task.Delay(ForfeitRetryDelay, _timeProvider);
            }
        }

        lock (_gate)
        {
            if (_channels.TryGetValue(channelId, out var channel))
                channel.ActiveForfeits.Remove(token);
        }
    }

    private async Task<DuelCommandResult> StartAsync(long offerId, StartDecision decision)
    {
        var reservation = decision.Token.Reservation;
        var precheckFailed = false;
        lock (_gate)
        {
            if (!OwnsStart(decision.Token)
                || !PairCommitted(reservation, DuelCommitmentKind.Active)
                || !StillPresent(reservation.PlayerOne, reservation.ChannelId)
                || !StillPresent(reservation.PlayerTwo, reservation.ChannelId))
            {
                if (OwnsStart(decision.Token))
                {
                    var channel = _channels[reservation.ChannelId];
                    decision.Token.CancellationReason ??= "disconnected";
                    channel.Starting = null;
                    ReleasePair(reservation);
                    channel.Advancing = true;
                    Bump(reservation.ChannelId, channel);
                }
                precheckFailed = true;
            }
        }
        if (precheckFailed)
        {
            await PublishReservationCancellationAsync(reservation, decision.Token.CancellationReason ?? "disconnected");
            await AdvanceChannelAsync(reservation.ChannelId);
            return new(false, offerId, reservation.ReservationId,
                "The reservation is no longer available.", DuelRejectReason.NotPresent);
        }

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
        string? staleReason;
        var completedDuringStart = false;
        lock (_gate)
        {
            staleReason = decision.Token.CancellationReason;
            completedDuringStart = decision.Token.CompletedDuringStart;
            if (OwnsStart(decision.Token))
            {
                var channel = _channels[reservation.ChannelId];
                ownedTransition = true;
                channel.Starting = null;
                if (!result.Success)
                {
                    ReleasePair(reservation);
                    channel.Advancing = true;
                    needsAdvancement = true;
                }
                else
                {
                    channel.Active = reservation;
                    channel.ActiveMatchId = result.MatchId;
                    channel.ActiveStartedAt = result.StartedAt ?? _timeProvider.GetUtcNow();
                    channel.Advancing = false;
                }
                Bump(reservation.ChannelId, channel);
            }
        }

        if (!ownedTransition)
        {
            if (result.Success && !completedDuringStart)
                await _runner.ForfeitAsync(result.MatchId, reservation.PlayerOne.UserId, staleReason ?? "disconnected");
            return new(false, offerId, reservation.ReservationId,
                "The match completed during startup.", DuelRejectReason.NotPresent);
        }
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
            if (!_channels.TryGetValue(completion.ChannelId, out var channel))
                return;
            if (channel.Starting?.Reservation.ReservationId == completion.ReservationId)
            {
                RetainCompletedSource(completion);
                channel.Starting.CompletedDuringStart = true;
                ReleasePair(channel.Starting.Reservation);
                channel.Starting = null;
                channel.Advancing = true;
                Bump(completion.ChannelId, channel);
                needsAdvancement = true;
                goto CompletionHandled;
            }
            if (channel.Active?.ReservationId != completion.ReservationId) return;
            RetainCompletedSource(completion);
            channel.Advancing = true;
            channel.ActiveForfeits.RemoveWhere(x => x.ReservationId == channel.Active.ReservationId);
            ReleasePair(channel.Active);
            channel.Active = null;
            needsAdvancement = true;
            Bump(completion.ChannelId, channel);
        CompletionHandled:;
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
                if (channel.Active is not null || channel.Starting is not null || channel.ReadyCheck is not null)
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
                    var clock = EnsureClock(channelId);
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
        try
        {
            Offer? offer = null;
            lock (_gate)
            {
                if (_offers.TryGetValue(offerId, out var current) && current.ExpiresAt == expiresAt)
                {
                    offer = current;
                    RemoveOffer(current, "expired");
                }
            }
            if (offer is not null) await PublishCancellationBestEffortAsync(offer, "expired");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to expire duel offer {OfferId}", offerId);
        }
    }

    private Task PublishCancellationAsync(Offer offer, string reason) =>
        offer.SourceMatchId is null
            ? _publisher.PublishToUsersAsync(ParticipantIds(offer), new
            {
                type = reason == "declined" ? "game.declined" : "game.expired",
                offerId = offer.Id,
                reason,
            })
            : _publisher.PublishToUsersAsync(ParticipantIds(offer), RematchMessage(
                reason == "expired" ? "game.rematchExpired"
                    : reason == "declined" ? "game.rematchDeclined" : "game.rematchCanceled",
                offer, offer.Target.UserId, reason));

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

    private Task PublishOfferResponseBestEffortAsync(Offer offer, bool accept) =>
        offer.SourceMatchId is null
            ? PublishBestEffortAsync(ParticipantIds(offer), new
            {
                type = accept ? "game.accepted" : "game.declined",
                offerId = offer.Id,
            })
            : PublishBestEffortAsync(ParticipantIds(offer), RematchMessage(
                accept ? "game.rematchAccepted" : "game.rematchDeclined",
                offer, offer.Target.UserId, accept ? "accepted" : "declined"));

    private static object RematchMessage(string type, Offer offer, long toUserId, string? reason = null) => new
    {
        type,
        offerId = offer.Id,
        sourceMatchId = offer.SourceMatchId,
        reservationId = offer.AcceptedReservationId,
        fromUserId = offer.Inviter.UserId,
        fromSessionId = offer.Inviter.SessionId,
        toUserId,
        toSessionId = offer.Target.SessionId,
        gameType = offer.Configuration.GameType,
        format = offer.Configuration.Format,
        rulesetVersion = offer.Configuration.RulesetVersion,
        options = offer.Configuration.Options,
        expiresAt = offer.ExpiresAt,
        inviteMs = (int)OfferLifetime.TotalMilliseconds,
        reason,
    };

    private async Task<DuelCommandResult?> FinalizeRematchPublicationStageAsync(Offer offer)
    {
        RematchTerminalOutcome? outcome = null;
        lock (_gate)
        {
            if (offer.OutstandingPublicationStages > 0)
                offer.OutstandingPublicationStages--;
            if (_rematchOutcomes.TryGetValue(offer.Id, out outcome))
            {
                offer.OutstandingPublicationStages = 0;
                RemoveRematchOutcome(offer.Id, out outcome);
            }
            else if (offer.OutstandingPublicationStages == 0)
                RemoveRematchOutcome(offer.Id, out _);
        }
        if (outcome is null) return null;
        await PublishBestEffortAsync(outcome.ParticipantIds, RematchTerminalMessage(outcome));
        return outcome.Kind == RematchTerminalKind.Accepted
            ? Success(outcome.OfferId, outcome.ReservationId)
            : Reject("This rematch offer is no longer available.", DuelRejectReason.StaleOffer);
    }

    private static object RematchTerminalMessage(RematchTerminalOutcome outcome) => new
    {
        type = outcome.Kind switch
        {
            RematchTerminalKind.Accepted => "game.rematchAccepted",
            RematchTerminalKind.Declined => "game.rematchDeclined",
            RematchTerminalKind.Expired => "game.rematchExpired",
            _ => "game.rematchCanceled",
        },
        offerId = outcome.OfferId,
        sourceMatchId = outcome.SourceMatchId,
        reservationId = outcome.ReservationId,
        reason = outcome.Reason,
    };

    private void RetainCompletedSource(MatchCompletion completion)
    {
        PruneCompletedSources();
        if (_completedSources.ContainsKey(completion.MatchId)) return;
        var options = new ReadOnlyDictionary<string, object?>(
            new Dictionary<string, object?>(completion.Configuration.Options));
        var configuration = completion.Configuration with { Options = options };
        var source = new CompletedDuelSource(
            completion.MatchId, completion.ChannelId, completion.PlayerOne, completion.PlayerTwo,
            configuration, completion.EndedAt);
        _completedSources.Add(source.MatchId, source);
        var next = _completedSourceOrder.First;
        while (next is not null && CompareCompletedSources(next.Value, source) <= 0)
            next = next.Next;
        var node = next is null
            ? _completedSourceOrder.AddLast(source)
            : _completedSourceOrder.AddBefore(next, source);
        _completedSourceNodes.Add(source.MatchId, node);
        PruneCompletedSources();
    }

    private void PruneCompletedSources()
    {
        var cutoff = _timeProvider.GetUtcNow() - CompletedSourceLifetime;
        while (_completedSourceOrder.First is { } node
            && (node.Value.CompletedAt <= cutoff || _completedSources.Count > CompletedSourceLimit))
        {
            RemoveCompletedSource(node.Value.MatchId);
        }
    }

    private void RemoveCompletedSource(long matchId)
    {
        _completedSources.Remove(matchId);
        if (_completedSourceNodes.Remove(matchId, out var node))
            _completedSourceOrder.Remove(node);
    }

    private static int CompareCompletedSources(CompletedDuelSource left, CompletedDuelSource right)
    {
        var completed = left.CompletedAt.CompareTo(right.CompletedAt);
        return completed != 0 ? completed : left.MatchId.CompareTo(right.MatchId);
    }

    private bool OwnsOffer(Offer offer) =>
        _offers.TryGetValue(offer.Id, out var current) && ReferenceEquals(current, offer);

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
            var clock = EnsureClock(channelId);
            if (clock.Generation == 0) clock.Generation = 1;
            _channels.Add(channelId, channel = new() { Generation = clock.Generation, Revision = clock.Revision });
        }
        return channel;
    }

    private ChannelClock EnsureClock(int channelId)
    {
        if (!_channelClocks.TryGetValue(channelId, out var clock))
            _channelClocks.Add(channelId, clock = new());
        return clock;
    }

    private void Bump(int channelId, ChannelState channel)
    {
        channel.Revision++;
        var clock = EnsureClock(channelId);
        clock.Generation = channel.Generation;
        clock.Revision = channel.Revision;
        EnqueueSnapshotPublication(channelId);
    }

    private ChannelSnapshotInput CaptureSnapshotInput(int channelId)
    {
        var now = _timeProvider.GetUtcNow();
        if (!_channels.TryGetValue(channelId, out var channel))
        {
            if (!_channelClocks.TryGetValue(channelId, out var missingClock))
                return new(channelId, 0, 0, now, null, null, []);
            return new(channelId, missingClock.Generation, missingClock.Revision, now, null, null, []);
        }

        ActiveSnapshotInput? active = null;
        if (channel.Active is not null && channel.ActiveMatchId is not null && channel.ActiveStartedAt is not null)
            active = new ActiveSnapshotInput(
                channel.ActiveMatchId.Value,
                channel.Active,
                channel.Active.Configuration,
                channel.ActiveStartedAt.Value);
        else if (channel.Starting is not null)
            active = new ActiveSnapshotInput(
                0,
                channel.Starting.Reservation,
                channel.Starting.Reservation.Configuration,
                channel.Starting.Reservation.AcceptedAt,
                "starting");
        var ready = channel.ReadyCheck is null
            ? null
            : new ReadySnapshotInput(channel.ReadyCheck.Reservation, channel.ReadyCheck.ExpiresAt)
            {
                ReadyUserIds = channel.ReadyCheck.ReadyUserIds.ToHashSet(),
            };
        return new(channelId, channel.Generation, channel.Revision, now, active, ready, channel.Queue.ToArray());
    }

    private async Task<DuelQueueSnapshot> BuildSnapshotAsync(ChannelSnapshotInput input)
    {
        var stopwatch = Stopwatch.StartNew();
        DurationEstimate? remaining = null;
        if (input.Active is not null)
        {
            remaining = _estimator is null
                ? DurationEstimate.Unknown(0)
                : input.Active.Status == "starting"
                    ? await _estimator.EstimateDurationAsync(input.Active.Configuration)
                    : await _estimator.EstimateRemainingAsync(
                        input.Active.Configuration,
                        Math.Max(0, (long)(input.CalculatedAt - input.Active.StartedAt).TotalMilliseconds));
        }
        var estimates = _estimator is null
            ? UnknownEstimates(input)
            : await _estimator.BuildEtasAsync(input, remaining);
        stopwatch.Stop();

        // A missing duration means the estimator broke its contract (a duration exists exactly
        // when the corresponding input does). Throw rather than publish a snapshot that omits a
        // section: clients treat snapshots as authoritative, so a silent omission reads as
        // "no active duel". Throwing routes into the publish lane's retry-and-log path instead.
        ActiveDuelSnapshot? active = null;
        if (input.Active is { } activeInput)
        {
            var activeRemaining = remaining
                ?? throw new InvalidOperationException(
                    "No remaining estimate was computed for an active duel.");
            var activeDuration = estimates.ActiveDuration
                ?? throw new InvalidOperationException(
                    "Estimator returned no duration for an active duel.");
            active = new ActiveDuelSnapshot(
                activeInput.MatchId,
                activeInput.Status,
                activeInput.StartedAt,
                Players(activeInput.Reservation!),
                activeInput.Configuration.GameType,
                activeInput.Configuration.Format,
                activeInput.Configuration.RulesetVersion,
                activeRemaining,
                activeDuration);
        }

        ReadyCheckSnapshot? ready = null;
        if (input.ReadyCheck is { } readyInput)
        {
            var readyDuration = estimates.ReadyDuration
                ?? throw new InvalidOperationException(
                    "Estimator returned no ready-check duration for a pending ready check.");
            ready = new ReadyCheckSnapshot(
                readyInput.Reservation.ReservationId,
                readyInput.ExpiresAt,
                Players(readyInput.Reservation, readyInput.ReadyUserIds),
                readyInput.Reservation.Configuration.GameType,
                readyInput.Reservation.Configuration.Format,
                readyInput.Reservation.Configuration.RulesetVersion,
                readyDuration);
        }

        var queue = input.Queue.Select((reservation, index) => new QueuedDuelSnapshot(
            reservation.ReservationId,
            index + 1,
            Players(reservation),
            reservation.Configuration.GameType,
            reservation.Configuration.Format,
            reservation.Configuration.RulesetVersion,
            estimates.Queue[index].Eta,
            estimates.Queue[index].Duration)).ToArray();
        return new(1, input.Generation, input.Revision, input.ChannelId, input.CalculatedAt,
            Math.Max(0, stopwatch.ElapsedMilliseconds), active, ready, queue);
    }

    private static DuelEstimates UnknownEstimates(ChannelSnapshotInput input) =>
        new(
            input.Queue
                .Select(_ => new QueueEstimate(
                    new QueueEtaSnapshot(EstimateStatus.Unknown, null, null, true, []),
                    DurationEstimate.Unknown(0)))
                .ToArray(),
            input.ReadyCheck is null ? null : DurationEstimate.Unknown(0),
            input.Active is null ? null : DurationEstimate.Unknown(0));

    internal Task DrainSnapshotPublicationsAsync(int channelId)
    {
        lock (_gate)
            return _snapshotLanes.TryGetValue(channelId, out var lane)
                ? lane.Idle.Task
                : Task.CompletedTask;
    }

    internal int SnapshotLaneCount
    {
        get { lock (_gate) return _snapshotLanes.Count; }
    }

    internal bool HasActiveSnapshotWorker(int channelId)
    {
        lock (_gate)
            return _snapshotLanes.TryGetValue(channelId, out var lane) && lane.Worker is not null;
    }

    private void EnqueueSnapshotPublication(int channelId)
    {
        lock (_gate)
        {
            if (!_snapshotLanes.TryGetValue(channelId, out var lane))
                _snapshotLanes[channelId] = lane = new();
            lane.Pending = true;
            if (lane.Worker is null)
            {
                lane.Idle = new(TaskCreationOptions.RunContinuationsAsynchronously);
                lane.Worker = Task.Run(() => PublishSnapshotsAsync(channelId, lane));
            }
        }
    }

    private async Task PublishSnapshotsAsync(int channelId, SnapshotLane lane)
    {
        var consecutiveFailures = 0;
        while (true)
        {
            ChannelSnapshotInput input;
            lock (_gate)
            {
                if (!_channels.ContainsKey(channelId) && consecutiveFailures > 0)
                {
                    // The channel disappeared while we were failing; nothing left worth publishing.
                    lane.Pending = false;
                    RetireLane(channelId, lane);
                    return;
                }

                lane.Pending = false;
                input = CaptureSnapshotInput(channelId);
            }

            try
            {
                var snapshot = await BuildSnapshotAsync(input);
                await _publisher.PublishToChannelAsync(channelId, DuelWire.ToEvent(snapshot));
                lock (_gate) lane.LastPublished = (input.Generation, input.Revision);
                consecutiveFailures = 0;
            }
            catch (Exception ex)
            {
                consecutiveFailures++;
                if (consecutiveFailures >= SnapshotPublicationAttemptLimit)
                {
                    _logger.LogError(ex,
                        "Failed to publish duel queue snapshot for channel {ChannelId} {Attempts} times; dropping snapshot at generation {Generation} revision {Revision}. Clients must recover via snapshot request.",
                        channelId, consecutiveFailures, input.Generation, input.Revision);
                    lock (_gate)
                    {
                        lane.Pending = false;
                        RetireLane(channelId, lane);
                        return;
                    }
                }

                _logger.LogWarning(ex, "Failed to publish duel queue snapshot for channel {ChannelId}; retrying", channelId);
                Task delay;
                lock (_gate)
                {
                    lane.Pending = true;
                    delay = Task.Delay(SnapshotRetryDelay, _timeProvider);
                    lane.RetryDelay = delay;
                }
                await delay;
                lock (_gate) lane.RetryDelay = null;
                continue;
            }

            lock (_gate)
            {
                if (lane.Pending) continue;
                RetireLane(channelId, lane);
                return;
            }
        }
    }

    /// <summary>
    /// Marks a snapshot lane idle and, when its channel no longer exists, drops the lane so
    /// removed channels do not retain a lane entry forever. Must be called under <c>_gate</c>.
    /// </summary>
    private void RetireLane(int channelId, SnapshotLane lane)
    {
        lane.Worker = null;
        lane.Idle.TrySetResult();
        if (!_channels.ContainsKey(channelId)
            && _snapshotLanes.TryGetValue(channelId, out var current)
            && ReferenceEquals(current, lane)
            && !lane.Pending
            && lane.Worker is null)
            _snapshotLanes.Remove(channelId);
    }

    private sealed class SnapshotLane
    {
        public bool Pending;
        public Task? Worker;
        public Task? RetryDelay;
        public TaskCompletionSource Idle { get; set; } = CompletedIdle();
        public (long Generation, long Revision) LastPublished;

        private static TaskCompletionSource CompletedIdle()
        {
            var source = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            source.SetResult();
            return source;
        }
    }

    internal bool IsSnapshotRetryWaiting(int channelId)
    {
        lock (_gate)
            return _snapshotLanes.TryGetValue(channelId, out var lane) && lane.RetryDelay is not null;
    }

    private void RemoveOffer(Offer offer, string? terminalReason = null)
    {
        if (!_offers.Remove(offer.Id)) return;
        offer.Timer?.Dispose();
        offer.TerminalReason = terminalReason;
        if (terminalReason is not null)
            RecordRematchOutcome(offer,
                terminalReason == "declined" ? RematchTerminalKind.Declined
                : terminalReason == "expired" ? RematchTerminalKind.Expired
                : RematchTerminalKind.Canceled,
                terminalReason);
        RemoveCommitment(offer.Inviter.UserId, offer.Id);
        RemoveCommitment(offer.Target.UserId, offer.Id);
    }

    private void RecordRematchOutcome(Offer offer, RematchTerminalKind kind, string reason)
    {
        if (offer.SourceMatchId is null || offer.OutstandingPublicationStages == 0) return;
        if (!_rematchOutcomes.ContainsKey(offer.Id))
            _rematchOutcomeOrder.Enqueue(offer.Id);
        _rematchOutcomes[offer.Id] = new(
            kind, offer.Id, offer.SourceMatchId.Value, offer.AcceptedReservationId,
            offer.ChannelId, ParticipantIds(offer), reason);
        while (_rematchOutcomes.Count > 1000 && _rematchOutcomeOrder.TryDequeue(out var oldest))
            _rematchOutcomes.Remove(oldest);
    }

    private bool RemoveRematchOutcome(long offerId, out RematchTerminalOutcome? outcome)
    {
        var removed = _rematchOutcomes.Remove(offerId, out outcome);
        if (!removed) return false;
        var remaining = _rematchOutcomeOrder.Where(x => x != offerId).ToArray();
        _rematchOutcomeOrder.Clear();
        foreach (var id in remaining) _rematchOutcomeOrder.Enqueue(id);
        return true;
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

    private bool PairCommitted(DuelReservation reservation, DuelCommitmentKind kind) =>
        _commitmentsByUserId.TryGetValue(reservation.PlayerOne.UserId, out var first)
        && first == new UserCommitment(kind, reservation.ReservationId)
        && _commitmentsByUserId.TryGetValue(reservation.PlayerTwo.UserId, out var second)
        && second == new UserCommitment(kind, reservation.ReservationId);

    private bool OwnsStart(StartToken token) =>
        _channels.TryGetValue(token.Reservation.ChannelId, out var channel)
        && ReferenceEquals(channel.Starting, token)
        && channel.Starting.Generation == token.Generation;

    private ReadyCheck RemoveReadyCheck(ChannelState channel, ReadyCheck ready)
    {
        channel.ReadyCheck = null;
        ready.Timer?.Dispose();
        ready.Timer = null;
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

    private static DuelQueueSnapshot EmptySnapshot(
        int channelId, long generation, long revision, DateTimeOffset generatedAt) =>
        new(1, generation, revision, channelId, generatedAt, 0, null, null, []);

    private sealed class Offer(
        long id,
        int channelId,
        DuelPlayer inviter,
        DuelPlayer target,
        DuelConfiguration configuration,
        DateTimeOffset expiresAt,
        long? sourceMatchId)
    {
        public long Id { get; } = id;
        public int ChannelId { get; } = channelId;
        public DuelPlayer Inviter { get; } = inviter;
        public DuelPlayer Target { get; } = target;
        public DuelConfiguration Configuration { get; } = configuration;
        public DateTimeOffset ExpiresAt { get; } = expiresAt;
        public long? SourceMatchId { get; } = sourceMatchId;
        public long? AcceptedReservationId { get; set; }
        public string? TerminalReason { get; set; }
        public int OutstandingPublicationStages { get; set; } = sourceMatchId is null ? 0 : 2;
        public ITimer? Timer { get; set; }
    }

    public sealed record CompletedDuelSource(
        long MatchId,
        int ChannelId,
        DuelPlayer PlayerOne,
        DuelPlayer PlayerTwo,
        DuelConfiguration Configuration,
        DateTimeOffset CompletedAt);

    private enum RematchTerminalKind { Accepted, Declined, Expired, Canceled }

    private sealed record RematchTerminalOutcome(
        RematchTerminalKind Kind,
        long OfferId,
        long SourceMatchId,
        long? ReservationId,
        int ChannelId,
        IReadOnlySet<long> ParticipantIds,
        string Reason);

    private sealed record UserCommitment(DuelCommitmentKind Kind, long Id);

    private sealed class ChannelState
    {
        public DuelReservation? Active;
        public long? ActiveMatchId;
        public DateTimeOffset? ActiveStartedAt;
        public StartToken? Starting;
        public Queue<DuelReservation> Queue { get; } = [];
        public ReadyCheck? ReadyCheck { get; set; }
        public bool Advancing;
        public long Generation;
        public long Revision;
        public long NextStartGeneration;
        public HashSet<ActiveForfeitToken> ActiveForfeits { get; } = [];
    }

    private sealed record ActiveForfeitToken(long ReservationId, long UserId);

    private sealed class StartToken(DuelReservation reservation, long generation)
    {
        public DuelReservation Reservation { get; } = reservation;
        public long Generation { get; } = generation;
        public string? CancellationReason { get; set; }
        public bool CompletedDuringStart { get; set; }
    }

    private sealed record StartDecision(StartToken Token);

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
