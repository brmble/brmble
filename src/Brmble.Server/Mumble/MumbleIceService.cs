using Brmble.Server.Matrix;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Mumble;

public class MumbleIceService : IHostedService
{
    private readonly MumbleServerCallback _callback;
    private readonly MatrixService _matrixService;
    private readonly string _host;
    private readonly int _port;
    private readonly string _secret;
    private readonly string _callbackHost;
    private readonly ILogger<MumbleIceService> _logger;
    private Ice.Communicator? _communicator;

    public MumbleIceService(
        MumbleServerCallback callback,
        MatrixService matrixService,
        IConfiguration configuration,
        ILogger<MumbleIceService> logger)
    {
        _callback = callback;
        _matrixService = matrixService;
        _host = configuration["Ice:Host"] ?? "mumble-server";
        _port = int.Parse(configuration["Ice:Port"] ?? "6502");
        _secret = configuration["Ice:Secret"] ?? string.Empty;
        _callbackHost = configuration["Ice:CallbackHost"] ?? System.Net.Dns.GetHostName();
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var properties = new Ice.Properties();
            properties.setProperty("Ice.Default.EncodingVersion", "1.0");
            properties.setProperty("Ice.MessageSizeMax", "10240"); // 10 MB (default is 1 MB)

            var initData = new Ice.InitializationData { properties = properties };
            _communicator = new Ice.Communicator(initData);

            var context = new Dictionary<string, string> { ["secret"] = _secret };
            var proxy = (_communicator.stringToProxy($"s/1 -e 1.0:tcp -h {_host} -p {_port}")
                ?? throw new InvalidOperationException("stringToProxy returned null"))
                .ice_context(context);
            var serverProxy = MumbleServer.ServerPrxHelper.checkedCast(proxy)
                ?? throw new InvalidOperationException("checkedCast failed — not a MumbleServer.Server");

            // Startup channel sync — ensure all existing channels have Matrix rooms.
            // Non-fatal: a conduwuit hiccup here should not prevent callback registration.
            var channels = serverProxy.getChannels();
            foreach (var (_, ch) in channels)
            {
                try
                {
                    await _matrixService.EnsureChannelRoom(new MumbleChannel(ch.id, ch.name));
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not ensure Matrix room for channel {Name}", ch.name);
                }
            }

            // Register callback adapter so Mumble can call back into us.
            // Configurable via Ice:CallbackHost; falls back to the container's hostname so
            // Mumble can reach us across Docker networks. 127.0.0.1 only works when both
            // processes share the same network namespace.
            var adapter = _communicator.createObjectAdapterWithEndpoints(
                "MumbleCallback", $"tcp -h {_callbackHost}");
            var callbackPrx = MumbleServer.ServerCallbackPrxHelper.uncheckedCast(
                adapter.addWithUUID(_callback));
            adapter.activate();
            serverProxy.addCallback(callbackPrx);

            _logger.LogInformation("Connected to Mumble server at {Host}:{Port}", _host, _port);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Failed to connect to Mumble server at {Host}:{Port} — " +
                "OG client message persistence is unavailable; Brmble chat is unaffected",
                _host, _port);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            _communicator?.destroy();
            _communicator = null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error shutting down Ice communicator");
        }
        return Task.CompletedTask;
    }
}
