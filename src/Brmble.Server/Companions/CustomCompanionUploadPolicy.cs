using System.Text.Json;
using System.Text.RegularExpressions;
using Brmble.Server.Auth;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Companions;

public static partial class CustomCompanionUploadPolicy
{
    private static readonly Regex ValidName = NameRegex();

    public static string? NormalizeName(string? name)
    {
        var normalized = name?.Trim();
        return normalized is not null && ValidName.IsMatch(normalized) ? normalized : null;
    }

    [GeneratedRegex("^[\\p{L}\\p{N} _-]{1,32}$", RegexOptions.CultureInvariant)]
    private static partial Regex NameRegex();
}

public sealed class CustomCompanionUploadService(
    ICertificateHashExtractor certificateHashExtractor,
    UserRepository userRepository,
    CustomCompanionRepository repository,
    CustomCompanionGalleryService galleryService,
    IMatrixAppService matrixAppService,
    IOptions<CustomCompanionOptions> options,
    IOptions<MatrixSettings> matrixSettings)
{
    private readonly SemaphoreSlim _uploadLock = new(1, 1);

    public async Task<IResult> CreateAsync(
        HttpContext httpContext,
        CustomCompanionCreateRequest request,
        CancellationToken cancellationToken)
    {
        await _uploadLock.WaitAsync(cancellationToken);
        try
        {
            var certHash = certificateHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepository.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            var uploadOptions = options.Value;
            if (await repository.CountActiveForUserAsync(user.Id) >= uploadOptions.MaxActivePerUser)
                return Results.Conflict(new { code = "user_limit" });
            if (await repository.CountActiveAsync() >= uploadOptions.MaxActiveTotal)
                return Results.Conflict(new { code = "server_limit" });

            if (!IsPermittedMediaUri(request.MediaUri, matrixSettings.Value.ServerDomain))
                return Results.UnprocessableEntity(new { code = "invalid_media_uri" });

            var normalizedName = CustomCompanionUploadPolicy.NormalizeName(request.Name);
            if (normalizedName is null)
                return Results.BadRequest(new { code = "invalid_name" });

            byte[] bytes;
            try
            {
                bytes = await matrixAppService.DownloadMedia(
                    request.MediaUri!, CustomCompanionOptions.MaxBytes + 1L, cancellationToken);
            }
            catch (InvalidDataException)
            {
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            }

            if (bytes.LongLength > CustomCompanionOptions.MaxBytes)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

            var validation = CustomCompanionImageValidator.Validate(bytes);
            if (!validation.IsValid)
                return ValidationFailure(validation.Code);

            var roomId = await galleryService.GetOrCreateRoomIdAsync(cancellationToken);
            var stateKey = Guid.NewGuid().ToString("N");
            var image = validation.Image!;
            var content = new Dictionary<string, object?>
            {
                ["schemaVersion"] = 1,
                ["name"] = normalizedName,
                ["mediaUri"] = request.MediaUri,
                ["mimeType"] = image.MimeType,
                ["width"] = image.Width,
                ["height"] = image.Height,
                ["frameCount"] = image.FrameCount,
                ["byteSize"] = bytes.LongLength,
                ["uploaderMatrixUserId"] = user.MatrixUserId,
                ["uploaderDisplayName"] = user.DisplayName
            };
            var eventId = await matrixAppService.SendStateEvent(
                roomId, "im.brmble.sprite", stateKey, JsonSerializer.Serialize(content));
            var record = new CustomCompanionRecord(
                eventId, stateKey, roomId, user.Id, user.MatrixUserId, user.DisplayName,
                normalizedName, request.MediaUri!, image.MimeType, image.Width, image.Height,
                image.FrameCount, bytes.LongLength, DateTimeOffset.UtcNow, null, null);

            try
            {
                await repository.InsertAsync(record);
            }
            catch
            {
                try
                {
                    await matrixAppService.RedactRoomEvent(roomId, eventId, "Removed after persistence failure");
                }
                catch
                {
                    // The database write is already failed; preserve the 503 outcome.
                }

                return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
            }

            return Results.Created($"/companions/{Uri.EscapeDataString(eventId)}", record);
        }
        finally
        {
            _uploadLock.Release();
        }
    }

    private static bool IsPermittedMediaUri(string? mediaUri, string serverDomain) =>
        Uri.TryCreate(mediaUri, UriKind.Absolute, out var uri) &&
        uri.Scheme.Equals("mxc", StringComparison.Ordinal) &&
        uri.Authority.Equals(serverDomain, StringComparison.Ordinal);

    private static IResult ValidationFailure(CompanionImageValidationCode code) => code switch
    {
        CompanionImageValidationCode.UnsupportedFormat =>
            Results.Json(new { code = "unsupported_file_type" }, statusCode: StatusCodes.Status415UnsupportedMediaType),
        CompanionImageValidationCode.InvalidImage =>
            Results.UnprocessableEntity(new { code = "invalid_image" }),
        CompanionImageValidationCode.UnsafeDimensions =>
            Results.UnprocessableEntity(new { code = "unsafe_image_dimensions" }),
        CompanionImageValidationCode.AnimationNotSupported =>
            Results.UnprocessableEntity(new { code = "animated_image_not_supported" }),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError)
    };
}
