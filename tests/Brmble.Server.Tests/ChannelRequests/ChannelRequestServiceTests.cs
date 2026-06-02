using Brmble.Server.ChannelRequests;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.ChannelRequests;

[TestClass]
public class ChannelRequestServiceTests
{
    [TestMethod]
    public async Task CreateAsync_RejectsExistingMumbleChannel()
    {
        var repo = new Mock<IChannelRequestRepository>();
        var mumble = new Mock<IChannelRequestMumbleService>();
        mumble.Setup(service => service.ChannelNameExistsAsync("raid team 2")).ReturnsAsync(true);

        var service = new ChannelRequestService(repo.Object, mumble.Object);
        var result = await service.CreateAsync(new AuthenticatedChannelRequestUser(7, "Alice"), "Raid Team 2", null);

        Assert.IsFalse(result.Success);
        Assert.AreEqual(ChannelRequestError.ChannelNameConflict.Code, result.Error!.Code);
    }

    [TestMethod]
    public async Task CreateAsync_ReturnsDuplicateWhenRepositoryRejectsConcurrentInsert()
    {
        var repo = new Mock<IChannelRequestRepository>();
        var mumble = new Mock<IChannelRequestMumbleService>();
        repo.Setup(r => r.CreatePendingAsync(
                It.IsAny<CreateChannelRequestRecord>(),
                ChannelRequestService.MaxPendingRequestsPerUser))
            .ReturnsAsync(new CreatePendingChannelRequestResult(CreatePendingChannelRequestOutcome.DuplicatePending, null));

        var service = new ChannelRequestService(repo.Object, mumble.Object);
        var result = await service.CreateAsync(new AuthenticatedChannelRequestUser(7, "Alice"), "Raid Team 2", null);

        Assert.IsFalse(result.Success);
        Assert.AreEqual(ChannelRequestError.DuplicatePendingRequest.Code, result.Error!.Code);
    }

    [TestMethod]
    public async Task ApproveAsync_StoresApprovedStateOnlyAfterMumbleCreateSucceeds()
    {
        var repo = new Mock<IChannelRequestRepository>();
        var mumble = new Mock<IChannelRequestMumbleService>();
        repo.SetupSequence(r => r.GetByIdAsync(5))
            .ReturnsAsync(PendingRequest())
            .ReturnsAsync(ApprovedRequest());
        mumble.Setup(service => service.FindChannelByNameAsync("raid team 2")).ReturnsAsync((CreatedMumbleChannel?)null);
        mumble.Setup(service => service.CreateChannelAsync("Raid Team 2")).ReturnsAsync(new CreatedMumbleChannel(42, "Raid Team 2"));
        repo.Setup(r => r.TryMarkApprovedAsync(5, 99, "Admin", 42, "Raid Team 2")).ReturnsAsync(true);

        var service = new ChannelRequestService(repo.Object, mumble.Object);
        var result = await service.ApproveAsync(5, new AuthenticatedChannelRequestUser(99, "Admin"));

        Assert.IsTrue(result.Success);
        repo.Verify(r => r.TryMarkApprovedAsync(5, 99, "Admin", 42, "Raid Team 2"), Times.Once);
    }

    [TestMethod]
    public async Task ApproveAsync_RetryHealsPendingRequestWhenMumbleChannelAlreadyExists()
    {
        var repo = new Mock<IChannelRequestRepository>();
        var mumble = new Mock<IChannelRequestMumbleService>();
        repo.SetupSequence(r => r.GetByIdAsync(5))
            .ReturnsAsync(PendingRequest() with { LastApprovalError = "mark approved timed out", ApprovalAttemptCount = 1 })
            .ReturnsAsync(ApprovedRequest() with { ApprovalAttemptCount = 2 });
        mumble.Setup(service => service.FindChannelByNameAsync("raid team 2")).ReturnsAsync(new CreatedMumbleChannel(42, "Raid Team 2"));
        repo.Setup(r => r.TryMarkApprovedAsync(5, 99, "Admin", 42, "Raid Team 2")).ReturnsAsync(true);

        var service = new ChannelRequestService(repo.Object, mumble.Object);
        var result = await service.ApproveAsync(5, new AuthenticatedChannelRequestUser(99, "Admin"));

        Assert.IsTrue(result.Success);
        mumble.Verify(service => service.CreateChannelAsync(It.IsAny<string>()), Times.Never);
    }

    private static ChannelRequest PendingRequest() =>
        new(5, 7, "Alice", "Raid Team 2", "raid team 2", null, ChannelRequestStatus.Pending, DateTime.UtcNow, DateTime.UtcNow, null, null, null, null, null, null, null, 0);

    private static ChannelRequest ApprovedRequest() =>
        new(5, 7, "Alice", "Raid Team 2", "raid team 2", null, ChannelRequestStatus.Approved, DateTime.UtcNow, DateTime.UtcNow, DateTime.UtcNow, 99, "Admin", null, 42, "Raid Team 2", null, 1);
}
