namespace Brmble.Server.Mumble;

public class MumbleServerCallback
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;

    public MumbleServerCallback(IEnumerable<IMumbleEventHandler> handlers)
    {
        _handlers = handlers;
    }

    // TODO: Wire to ZeroC Ice ServerCallback methods.
    // Each Ice callback dispatches to all _handlers, e.g.:
    //   await Task.WhenAll(_handlers.Select(h => h.OnUserTextMessage(user, text, channelId)));
}
