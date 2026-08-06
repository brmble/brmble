using System.Text.Json;
using System.Text.Json.Nodes;
using Brmble.Server.Messages;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Messages;

[TestClass]
public sealed class MessageDeletionPolicyTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 8, 6, 12, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void AuthorMessage_OneMillisecondInsideWindow_IsAllowed()
    {
        var message = Message(
            sender: "@alice:test",
            timestamp: Now - TimeSpan.FromHours(24) + TimeSpan.FromMilliseconds(1));

        var result = MessageDeletionPolicy.Evaluate(
            message, "@alice:test", canModerate: false, Now);

        Assert.AreEqual(MessageDeletionDecision.Allowed, result);
    }

    [TestMethod]
    public void AuthorMessage_ExactlyTwentyFourHoursOld_IsExpired()
    {
        var message = Message("@alice:test", Now - TimeSpan.FromHours(24));

        var result = MessageDeletionPolicy.Evaluate(
            message, "@alice:test", canModerate: false, Now);

        Assert.AreEqual(MessageDeletionDecision.Expired, result);
    }

    [TestMethod]
    public void OtherUsersMessage_WithoutAdminPermission_IsForbidden()
    {
        var message = Message("@bob:test", Now - TimeSpan.FromMinutes(10));

        var result = MessageDeletionPolicy.Evaluate(
            message, "@alice:test", canModerate: false, Now);

        Assert.AreEqual(MessageDeletionDecision.Forbidden, result);
    }

    [TestMethod]
    public void OtherUsersRecentMessage_WithAdminPermission_IsAllowed()
    {
        var message = Message("@bob:test", Now - TimeSpan.FromMinutes(10));

        var result = MessageDeletionPolicy.Evaluate(
            message, "@alice:test", canModerate: true, Now);

        Assert.AreEqual(MessageDeletionDecision.Allowed, result);
    }

    [TestMethod]
    public void BridgedMessage_EffectiveAuthor_IsAllowed()
    {
        var message = new MatrixMessageMetadata(
            "m.room.message", "@brmble:test", Now - TimeSpan.FromMinutes(10), false,
            "@alice:test");

        Assert.AreEqual(
            MessageDeletionDecision.Allowed,
            MessageDeletionPolicy.Evaluate(message, "@alice:test", false, Now));
    }

    [TestMethod]
    public void RedactedMessage_IsAlreadyDeleted()
    {
        var message = Message(
            "@alice:test",
            Now - TimeSpan.FromMinutes(10),
            isRedacted: true);

        var result = MessageDeletionPolicy.Evaluate(
            message, "@alice:test", canModerate: false, Now);

        Assert.AreEqual(MessageDeletionDecision.AlreadyDeleted, result);
    }

    [TestMethod]
    public void FutureDatedMessage_IsInvalid()
    {
        var message = Message(
            "@alice:test",
            Now + TimeSpan.FromMilliseconds(1));

        var result = MessageDeletionPolicy.Evaluate(
            message, "@alice:test", canModerate: false, Now);

        Assert.AreEqual(MessageDeletionDecision.InvalidEvent, result);
    }

    [TestMethod]
    public void Parse_ReadsSenderTimestampTypeAndRedactionState()
    {
        var json = JsonSerializer.SerializeToElement(new
        {
            type = "m.room.message",
            sender = "@alice:test",
            origin_server_ts = Now.ToUnixTimeMilliseconds(),
            content = new { msgtype = "m.text", body = "hello" },
            unsigned = new
            {
                redacted_because = new { type = "m.room.redaction" }
            }
        });

        var parsed = MatrixMessageMetadata.Parse(json);

        Assert.AreEqual("m.room.message", parsed.EventType);
        Assert.AreEqual("@alice:test", parsed.Sender);
        Assert.AreEqual(Now, parsed.OriginServerTimestamp);
        Assert.IsTrue(parsed.IsRedacted);
    }

    [TestMethod]
    public void Parse_ReadsNonEmptyBridgedAuthorMetadata()
    {
        var content = new JsonObject
        {
            ["msgtype"] = "m.text",
            ["body"] = "[Alice]: hello",
            ["com.brmble.author_matrix_user_id"] = "@alice:test"
        };
        var json = JsonSerializer.SerializeToElement(new
        {
            type = "m.room.message",
            sender = "@brmble:test",
            origin_server_ts = Now.ToUnixTimeMilliseconds(),
            content
        });

        var parsed = MatrixMessageMetadata.Parse(json);

        Assert.AreEqual("@alice:test", parsed.AuthorMatrixUserId);
    }

    private static MatrixMessageMetadata Message(
        string sender,
        DateTimeOffset timestamp,
        bool isRedacted = false) =>
        new("m.room.message", sender, timestamp, isRedacted);
}
