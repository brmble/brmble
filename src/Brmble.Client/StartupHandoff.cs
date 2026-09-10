using Brmble.Client.Bridge;

namespace Brmble.Client;

internal sealed class StartupHandoff
{
    internal const string ReadyMessageType = "app.ready";

    private const int Waiting = 0;
    private const int Ready = 1;
    private const int Failed = 2;

    private readonly Action _onReady;
    private readonly Action _onFailure;
    private int _state = Waiting;

    internal StartupHandoff(Action onReady, Action onFailure)
    {
        _onReady = onReady;
        _onFailure = onFailure;
    }

    internal void Register(NativeBridge bridge)
    {
        bridge.RegisterHandler(ReadyMessageType, _ =>
        {
            OnAppReady();
            return Task.CompletedTask;
        });
    }

    internal void OnMainNavigationCompleted(bool isSuccess)
    {
        if (isSuccess)
            return;

        if (Interlocked.CompareExchange(ref _state, Failed, Waiting) == Waiting)
            _onFailure();
    }

    private void OnAppReady()
    {
        if (Interlocked.CompareExchange(ref _state, Ready, Waiting) == Waiting)
            _onReady();
    }
}
