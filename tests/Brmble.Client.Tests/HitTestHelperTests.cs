using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client;

namespace Brmble.Client.Tests;

[TestClass]
public class HitTestHelperTests
{
    // Window: 800 wide, 600 tall, border: 6px

    [TestMethod] public void Center_ReturnsClient()
        => Assert.AreEqual(HitTestHelper.HtClient, HitTestHelper.Calculate(400, 300, 800, 600, 6));

    [TestMethod] public void TopEdge_ReturnsTop()
        => Assert.AreEqual(HitTestHelper.HtTop, HitTestHelper.Calculate(400, 3, 800, 600, 6));

    [TestMethod] public void BottomEdge_ReturnsBottom()
        => Assert.AreEqual(HitTestHelper.HtBottom, HitTestHelper.Calculate(400, 597, 800, 600, 6));

    [TestMethod] public void LeftEdge_ReturnsLeft()
        => Assert.AreEqual(HitTestHelper.HtLeft, HitTestHelper.Calculate(3, 300, 800, 600, 6));

    [TestMethod] public void RightEdge_ReturnsRight()
        => Assert.AreEqual(HitTestHelper.HtRight, HitTestHelper.Calculate(797, 300, 800, 600, 6));

    [TestMethod] public void TopLeftCorner_ReturnsTopLeft()
        => Assert.AreEqual(HitTestHelper.HtTopLeft, HitTestHelper.Calculate(2, 2, 800, 600, 6));

    [TestMethod] public void TopRightCorner_ReturnsTopRight()
        => Assert.AreEqual(HitTestHelper.HtTopRight, HitTestHelper.Calculate(797, 2, 800, 600, 6));

    [TestMethod] public void BottomLeftCorner_ReturnsBottomLeft()
        => Assert.AreEqual(HitTestHelper.HtBottomLeft, HitTestHelper.Calculate(2, 597, 800, 600, 6));

    [TestMethod] public void BottomRightCorner_ReturnsBottomRight()
        => Assert.AreEqual(HitTestHelper.HtBottomRight, HitTestHelper.Calculate(797, 597, 800, 600, 6));

    [TestMethod] public void ExactlyAtBorder_ReturnsEdge()
        => Assert.AreEqual(HitTestHelper.HtLeft, HitTestHelper.Calculate(5, 300, 800, 600, 6));

    [TestMethod] public void JustInsideBorder_ReturnsClient()
        => Assert.AreEqual(HitTestHelper.HtClient, HitTestHelper.Calculate(6, 300, 800, 600, 6));
}
