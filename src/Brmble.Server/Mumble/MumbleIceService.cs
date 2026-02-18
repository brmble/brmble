namespace Brmble.Server.Mumble;

public class MumbleIceService : IHostedService
{
    private readonly MumbleServerCallback _callback;

    public MumbleIceService(MumbleServerCallback callback)
    {
        _callback = callback;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // TODO: Initialize Ice communicator, connect to Mumble server, register _callback.
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        // TODO: Cleanly shut down Ice communicator.
        return Task.CompletedTask;
    }
}
