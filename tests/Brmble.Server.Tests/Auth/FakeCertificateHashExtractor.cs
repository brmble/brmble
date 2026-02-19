// tests/Brmble.Server.Tests/Auth/FakeCertificateHashExtractor.cs
using Brmble.Server.Auth;
using Microsoft.AspNetCore.Http;

namespace Brmble.Server.Tests.Auth;

internal class FakeCertificateHashExtractor : ICertificateHashExtractor
{
    private readonly string? _hash;

    public FakeCertificateHashExtractor(string? hash)
    {
        _hash = hash;
    }

    public string? GetCertHash(HttpContext context) => _hash;
}
