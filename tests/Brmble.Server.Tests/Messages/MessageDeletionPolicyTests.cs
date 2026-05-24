using Brmble.Server.Messages;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Messages;

[TestClass]
public sealed class MessageDeletionPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 5, 23, 12, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void Decide_Allows_Own_Message_Within_24_Hours()
    {
        var policy = new MessageDeletionPolicy();
        var targetEvent = Event(sender: "@alice:example.com", sentAt: Now.AddHours(-23));

        var decision = policy.Decide(targetEvent, "@alice:example.com", requesterIsAdmin: false, Now);

        Assert.IsTrue(decision.Allowed);
        Assert.AreEqual(MessageDeletionReasons.SelfDelete, decision.Reason);
        Assert.AreEqual(MessageDeletionPlaceholders.SelfDeleted, decision.PlaceholderText);
        Assert.AreEqual("user", decision.ActorType);
    }

    [TestMethod]
    public void Decide_Denies_Own_Message_After_24_Hours()
    {
        var policy = new MessageDeletionPolicy();
        var targetEvent = Event(sender: "@alice:example.com", sentAt: Now.AddHours(-24).AddSeconds(-1));

        var decision = policy.Decide(targetEvent, "@alice:example.com", requesterIsAdmin: false, Now);

        Assert.IsFalse(decision.Allowed);
        Assert.AreEqual("message_too_old", decision.DenialCode);
    }

    [TestMethod]
    public void Decide_Denies_Other_User_Message_For_Regular_User()
    {
        var policy = new MessageDeletionPolicy();
        var targetEvent = Event(sender: "@bob:example.com", sentAt: Now.AddMinutes(-10));

        var decision = policy.Decide(targetEvent, "@alice:example.com", requesterIsAdmin: false, Now);

        Assert.IsFalse(decision.Allowed);
        Assert.AreEqual("not_message_owner", decision.DenialCode);
    }

    [TestMethod]
    public void Decide_Allows_Admin_To_Delete_Any_Message()
    {
        var policy = new MessageDeletionPolicy();
        var targetEvent = Event(sender: "@bob:example.com", sentAt: Now.AddDays(-90));

        var decision = policy.Decide(targetEvent, "@admin:example.com", requesterIsAdmin: true, Now);

        Assert.IsTrue(decision.Allowed);
        Assert.AreEqual(MessageDeletionReasons.ModeratorDelete, decision.Reason);
        Assert.AreEqual(MessageDeletionPlaceholders.ModeratorDeleted, decision.PlaceholderText);
        Assert.AreEqual("admin", decision.ActorType);
    }

    [TestMethod]
    public void Decide_Denies_Already_Redacted_Event()
    {
        var policy = new MessageDeletionPolicy();
        var targetEvent = Event(sender: "@alice:example.com", sentAt: Now.AddMinutes(-1), isAlreadyRedacted: true);

        var decision = policy.Decide(targetEvent, "@alice:example.com", requesterIsAdmin: false, Now);

        Assert.IsFalse(decision.Allowed);
        Assert.AreEqual("already_deleted", decision.DenialCode);
    }

    [TestMethod]
    public void Decide_Denies_Unsupported_Event_Type()
    {
        var policy = new MessageDeletionPolicy();
        var targetEvent = Event(sender: "@alice:example.com", sentAt: Now.AddMinutes(-1), eventType: "m.room.member");

        var decision = policy.Decide(targetEvent, "@alice:example.com", requesterIsAdmin: true, Now);

        Assert.IsFalse(decision.Allowed);
        Assert.AreEqual("unsupported_event_type", decision.DenialCode);
    }

    [TestMethod]
    public void Decide_Denies_State_Event_Even_When_Type_Is_Deletable()
    {
        var policy = new MessageDeletionPolicy();
        var targetEvent = Event(
            sender: "@alice:example.com",
            sentAt: Now.AddMinutes(-1),
            eventType: "m.room.message",
            isStateEvent: true);

        var decision = policy.Decide(targetEvent, "@alice:example.com", requesterIsAdmin: true, Now);

        Assert.IsFalse(decision.Allowed);
        Assert.AreEqual("state_event_not_deletable", decision.DenialCode);
    }

    private static MatrixTimelineEventInfo Event(
        string sender,
        DateTimeOffset sentAt,
        string eventType = "m.room.message",
        bool isAlreadyRedacted = false,
        bool isStateEvent = false)
    {
        return new MatrixTimelineEventInfo(
            RoomId: "!room:example.com",
            EventId: "$event:example.com",
            SenderMatrixUserId: sender,
            OriginServerTimestamp: sentAt,
            EventType: eventType,
            IsAlreadyRedacted: isAlreadyRedacted,
            IsStateEvent: isStateEvent);
    }
}
