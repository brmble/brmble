using Brmble.Server.Companions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Companions;

[TestClass]
public sealed class CustomCompanionUploadPolicyTests
{
    [DataTestMethod]
    [DataRow("", false)]
    [DataRow(" ", false)]
    [DataRow("A", true)]
    [DataRow("My_sprite-2", true)]
    [DataRow("line\nbreak", false)]
    [DataRow("bad!", false)]
    public void NormalizeName_EnforcesTheNameRule(string value, bool valid)
    {
        Assert.AreEqual(valid, CustomCompanionUploadPolicy.NormalizeName(value) is not null);
    }
}
