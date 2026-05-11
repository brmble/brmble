namespace Brmble.Client.Overlay;

internal sealed class CompanionOverlayRelay
{
    private string? _latestPayload;
    private Action<string>? _sink;

    public void UpdatePayload(string payload)
    {
        _latestPayload = payload;
        _sink?.Invoke(payload);
    }

    public void AttachSink(Action<string> sink)
    {
        _sink = sink;
        if (_latestPayload is not null)
        {
            _sink(_latestPayload);
        }
    }

    public void DetachSink()
    {
        _sink = null;
    }
}
