using Brmble.Server.Auth;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;

namespace Brmble.Server.Messages;

public sealed record MessageDeletionResult(
    bool Success,
    int StatusCode,
    string? ErrorCode,
    DeleteMessageResponse? Response);

public sealed class MessageDeletionService
{
    private readonly IMatrixAppService _matrixAppService;
    private readonly UserRepository _userRepository;
    private readonly IAclAuthorizationService _aclAuthorizationService;
    private readonly MessageDeletionRepository _repository;
    private readonly MessageDeletionPolicy _policy;
    private readonly ILogger<MessageDeletionService> _logger;

    public MessageDeletionService(
        IMatrixAppService matrixAppService,
        UserRepository userRepository,
        IAclAuthorizationService aclAuthorizationService,
        MessageDeletionRepository repository,
        MessageDeletionPolicy policy,
        ILogger<MessageDeletionService> logger)
    {
        _matrixAppService = matrixAppService;
        _userRepository = userRepository;
        _aclAuthorizationService = aclAuthorizationService;
        _repository = repository;
        _policy = policy;
        _logger = logger;
    }

    public async Task<MessageDeletionResult> DeleteAsync(
        string requesterAccessToken,
        DeleteMessageRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await _userRepository.GetByMatrixAccessToken(requesterAccessToken);
        if (user is null)
        {
            return new MessageDeletionResult(false, StatusCodes.Status401Unauthorized, "unauthorized", null);
        }

        var targetEvent = await _matrixAppService.GetRoomEventAsync(
            request.RoomId,
            request.EventId,
            requesterAccessToken,
            cancellationToken);
        if (targetEvent is null)
        {
            return new MessageDeletionResult(false, StatusCodes.Status404NotFound, "event_not_found", null);
        }

        var isAdmin = await _aclAuthorizationService.CanManageChannelAclAsync(user.Id, 0);
        var decision = _policy.Decide(targetEvent, user.MatrixUserId, isAdmin, DateTimeOffset.UtcNow);
        if (!decision.Allowed)
        {
            var statusCode = decision.DenialCode == "already_deleted"
                ? StatusCodes.Status409Conflict
                : StatusCodes.Status403Forbidden;
            return new MessageDeletionResult(false, statusCode, decision.DenialCode, null);
        }

        var txnId = string.IsNullOrWhiteSpace(request.TxnId) ? Guid.NewGuid().ToString("N") : request.TxnId!;
        var redactionEventId = await _matrixAppService.RedactEventAsync(
            request.RoomId,
            request.EventId,
            txnId,
            decision.Reason!,
            user.MatrixUserId,
            cancellationToken);

        var response = new DeleteMessageResponse(
            request.RoomId,
            request.EventId,
            redactionEventId,
            decision.Reason!,
            decision.PlaceholderText!,
            decision.ActorType!);

        try
        {
            await _repository.SaveAsync(new MessageRedactionAuditRecord(
                request.RoomId,
                request.EventId,
                redactionEventId,
                user.MatrixUserId,
                decision.Reason!,
                decision.PlaceholderText!,
                decision.ActorType!,
                DateTimeOffset.UtcNow), cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Message deletion succeeded in Matrix but audit persistence failed for event {EventId}", request.EventId);
        }

        return new MessageDeletionResult(true, StatusCodes.Status200OK, null, response);
    }
}
