namespace Brmble.Server.Mumble;

public sealed class MumbleIceCommunicatorFactory : IMumbleIceCommunicatorFactory
{
    public Ice.Communicator Create()
    {
        var properties = new Ice.Properties();
        properties.setProperty("Ice.Default.EncodingVersion", "1.0");
        properties.setProperty("Ice.MessageSizeMax", "65536");

        var initData = new Ice.InitializationData { properties = properties };
        return new Ice.Communicator(initData);
    }
}
