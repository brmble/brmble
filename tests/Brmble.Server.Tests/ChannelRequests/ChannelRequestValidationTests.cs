using Brmble.Server.ChannelRequests;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.ChannelRequests;

[TestClass]
public class ChannelRequestValidationTests
{
    [TestMethod]
    public void ValidateCreate_TrimsAndNormalizesValidInput()
    {
        var result = ChannelRequestValidation.ValidateCreate("  Raid Team 2  ", " Weekly runs ");

        Assert.IsTrue(result.IsValid);
        Assert.AreEqual("Raid Team 2", result.ChannelName);
        Assert.AreEqual("raid team 2", result.NormalizedChannelName);
        Assert.AreEqual("Weekly runs", result.Reason);
    }

    [TestMethod]
    public void ValidateCreate_RejectsSlashCharacters()
    {
        var result = ChannelRequestValidation.ValidateCreate("Raid/Team", null);

        Assert.IsFalse(result.IsValid);
        Assert.AreEqual(ChannelRequestError.InvalidChannelName.Code, result.Error!.Code);
    }

    [TestMethod]
    public void ValidateCreate_RejectsTooLongReason()
    {
        var result = ChannelRequestValidation.ValidateCreate("Raid Team", new string('x', 401));

        Assert.IsFalse(result.IsValid);
        Assert.AreEqual(ChannelRequestError.ReasonTooLong.Code, result.Error!.Code);
    }
}
