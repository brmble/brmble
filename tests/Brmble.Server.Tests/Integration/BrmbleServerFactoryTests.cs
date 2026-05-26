using Brmble.Server.Mumble;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class BrmbleServerFactoryTests
{
    [TestMethod]
    public void Services_DoesNotRegisterMumbleIceServiceAsHostedService()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var hostedServices = factory.Services.GetServices<IHostedService>();

        Assert.IsFalse(hostedServices.Any(service => service.GetType() == typeof(MumbleIceService)));
    }
}
