using System;

namespace Brmble.Client.Bridge;

public interface IService
{
    string ServiceName { get; }
    void Initialize(NativeBridge bridge);
    void RegisterHandlers(NativeBridge bridge);
}
