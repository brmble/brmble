using System.Text.Json;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class MatrixPaintSourceResolverTests
{
    [TestMethod]
    public async Task ResolveAsync_ReturnsValidatedPngSource()
    {
        var matrix = new FakeMatrixPaintService
        {
            EventRoomId = "!paint:server",
            EventType = "m.room.message",
            MxcUrl = "mxc://server/source",
            MediaBytes = ImageFixtures.Png1x1,
            SizeBytes = ImageFixtures.Png1x1.Length,
        };
        var resolver = new MatrixPaintSourceResolver(matrix);

        var source = await resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None);

        Assert.AreEqual("!paint:server", source.MatrixRoomId);
        Assert.AreEqual("$source", source.SourceEventId);
        Assert.AreEqual("image/png", source.MimeType);
        Assert.AreEqual(1, source.Width);
        Assert.AreEqual(1, source.Height);
    }

    [TestMethod]
    public async Task ResolveAsync_RejectsImageUploadedByAnyoneOtherThanTheHost()
    {
        var service = new FakeMatrixPaintService
        {
            EventRoomId = "!paint:test",
            Sender = "@other:test",
            MediaBytes = ImageFixtures.Png1x1,
            SizeBytes = ImageFixtures.Png1x1.Length,
        };
        var resolver = new MatrixPaintSourceResolver(service);

        await Assert.ThrowsExceptionAsync<PaintValidationException>(() =>
            resolver.ResolveAsync("!paint:test", "@host:test", "$source", CancellationToken.None));
    }

    [TestMethod]
    public async Task ResolveAsync_RejectsEventFromDifferentRoom()
    {
        var matrix = new FakeMatrixPaintService
        {
            EventRoomId = "!other:server",
            EventType = "m.room.message",
            MxcUrl = "mxc://server/source",
            MediaBytes = ImageFixtures.Png1x1,
            SizeBytes = ImageFixtures.Png1x1.Length,
        };
        var resolver = new MatrixPaintSourceResolver(matrix);

        await Assert.ThrowsExceptionAsync<PaintValidationException>(() =>
            resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None));
    }

    [TestMethod]
    public async Task ResolveAsync_RejectsNonImageEvent()
    {
        var matrix = new FakeMatrixPaintService
        {
            EventRoomId = "!paint:server",
            EventType = "m.text",
            MxcUrl = "mxc://server/source",
            MediaBytes = ImageFixtures.Png1x1,
            SizeBytes = ImageFixtures.Png1x1.Length,
        };
        var resolver = new MatrixPaintSourceResolver(matrix);

        await Assert.ThrowsExceptionAsync<PaintValidationException>(() =>
            resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None));
    }

    [TestMethod]
    public async Task ResolveAsync_RejectsSvgSource()
    {
        var matrix = new FakeMatrixPaintService
        {
            EventRoomId = "!paint:server",
            EventType = "m.room.message",
            MxcUrl = "mxc://server/source",
            MimeType = "image/svg+xml",
            MediaBytes = """<svg xmlns="http://www.w3.org/2000/svg"></svg>"""u8.ToArray(),
            SizeBytes = 46,
        };
        var resolver = new MatrixPaintSourceResolver(matrix);

        await Assert.ThrowsExceptionAsync<PaintValidationException>(() =>
            resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None));
    }

    [TestMethod]
    public async Task ResolveAsync_RejectsGifSource()
    {
        var matrix = new FakeMatrixPaintService
        {
            EventRoomId = "!paint:server",
            EventType = "m.room.message",
            MxcUrl = "mxc://server/source",
            MimeType = "image/gif",
            MediaBytes = ImageFixtures.Gif1x1,
            SizeBytes = ImageFixtures.Gif1x1.Length,
        };
        var resolver = new MatrixPaintSourceResolver(matrix);

        await Assert.ThrowsExceptionAsync<PaintValidationException>(() =>
            resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None));
    }

    [TestMethod]
    public async Task ResolveAsync_RejectsOversizedDimensions()
    {
        var matrix = new FakeMatrixPaintService
        {
            EventRoomId = "!paint:server",
            EventType = "m.room.message",
            MxcUrl = "mxc://server/source",
            MediaBytes = ImageFixtures.Png5000x1,
            SizeBytes = ImageFixtures.Png5000x1.Length,
        };
        var resolver = new MatrixPaintSourceResolver(matrix);

        await Assert.ThrowsExceptionAsync<PaintValidationException>(() =>
            resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None));
    }

    [TestMethod]
    public async Task ResolveAsync_PropagatesMediaDownloadFailure()
    {
        var matrix = new FakeMatrixPaintService
        {
            EventRoomId = "!paint:server",
            EventType = "m.room.message",
            MxcUrl = "mxc://server/source",
            DownloadException = new HttpRequestException("boom"),
        };
        var resolver = new MatrixPaintSourceResolver(matrix);

        await Assert.ThrowsExceptionAsync<HttpRequestException>(() =>
            resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None));
    }

    [TestMethod]
    public async Task ResolveAsync_RejectsMalformedMatrixEventWithPaintValidationError()
    {
        var matrix = new FakeMatrixPaintService { RawEvent = "{\"room_id\":\"!paint:server\"}" };
        var resolver = new MatrixPaintSourceResolver(matrix);

        var exception = await Assert.ThrowsExceptionAsync<PaintValidationException>(() =>
            resolver.ResolveAsync("!paint:server", "@host:test", "$source", CancellationToken.None));

        StringAssert.Contains(exception.Message, "source event");
    }

    private sealed class FakeMatrixPaintService : IMatrixPaintService
    {
        public string EventRoomId { get; init; } = "!paint:server";
        public string EventType { get; init; } = "m.room.message";
        public string MessageType { get; init; } = "m.image";
        public string Sender { get; init; } = "@host:test";
        public string MxcUrl { get; init; } = "mxc://server/source";
        public string MimeType { get; init; } = "image/png";
        public byte[] MediaBytes { get; init; } = [];
        public long SizeBytes { get; init; }
        public Exception? DownloadException { get; init; }
        public string? RawEvent { get; init; }

        public Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> invitedMatrixUserIds, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task InvitePaintUserAsync(string roomId, string matrixUserId, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken cancellationToken)
        {
            if (RawEvent is not null)
            {
                return Task.FromResult(JsonDocument.Parse(RawEvent).RootElement.Clone());
            }

            var payload = JsonSerializer.SerializeToElement(new
            {
                room_id = EventRoomId,
                sender = Sender,
                type = EventType,
                content = new
                {
                    msgtype = MessageType,
                    body = "source",
                    url = MxcUrl,
                    info = new
                    {
                        mimetype = MimeType,
                        size = SizeBytes,
                    },
                },
            });

            return Task.FromResult(payload);
        }

        public Task<string?> GetMembershipAsync(string roomId, string matrixUserId, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken cancellationToken)
        {
            if (DownloadException is not null)
            {
                throw DownloadException;
            }

            return Task.FromResult(MediaBytes);
        }

        public Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken)
            => throw new NotSupportedException();
    }

    private static class ImageFixtures
    {
        public static readonly byte[] Png1x1 =
        [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00,
            0x1F, 0x15, 0xC4, 0x89
        ];

        public static readonly byte[] Png5000x1 =
        [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x13, 0x88, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00
        ];

        public static readonly byte[] Gif1x1 =
        [
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
            0x01, 0x00, 0x01, 0x00,
            0x80, 0x00, 0x00,
            0x00, 0x00, 0x00,
            0xFF, 0xFF, 0xFF,
            0x21, 0xF9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
            0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B
        ];
    }
}
