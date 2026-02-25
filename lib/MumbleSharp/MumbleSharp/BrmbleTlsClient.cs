using System.Collections.Generic;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Org.BouncyCastle.Crypto;
using Org.BouncyCastle.Security;
using Org.BouncyCastle.Tls;
using Org.BouncyCastle.Tls.Crypto;
using Org.BouncyCastle.Tls.Crypto.Impl.BC;
using BcCertificateRequest = Org.BouncyCastle.Tls.CertificateRequest;

namespace MumbleSharp
{
    /// <summary>
    /// BouncyCastle TLS client for mTLS connections, bypassing Windows SChannel
    /// which silently refuses to present self-signed client certificates.
    /// </summary>
    public class BrmbleTlsClient : DefaultTlsClient
    {
        private readonly X509Certificate2 _clientCert;
        private readonly string _serverName; // null means no SNI

        /// <param name="clientCert">
        /// Client certificate for mTLS, or null for server-only TLS.
        /// Private key must be exportable (X509KeyStorageFlags.Exportable).
        /// </param>
        /// <param name="serverName">
        /// Hostname sent in the TLS SNI extension. Pass the DNS hostname when
        /// the server uses SNI-based virtual hosting or requires it for cert selection.
        /// </param>
        public BrmbleTlsClient(X509Certificate2 clientCert, string serverName = null)
            : base(new BcTlsCrypto(new SecureRandom()))
        {
            _clientCert = clientCert;
            _serverName = serverName;
        }

        protected override IList<ServerName> GetSniServerNames()
        {
            if (_serverName != null)
                return new List<ServerName> { new ServerName(NameType.host_name, Encoding.UTF8.GetBytes(_serverName)) };
            return base.GetSniServerNames();
        }

        internal TlsContext TlsContext => m_context;

        // Restrict to TLS 1.2 — Mumble protocol uses TLS 1.2, and our Certificate
        // object uses the TLS 1.2 format (TlsCertificate[]) which is incompatible
        // with TLS 1.3's CertificateEntry[] format.
        protected override ProtocolVersion[] GetSupportedVersions()
        {
            return new[] { ProtocolVersion.TLSv12 };
        }

        public override TlsAuthentication GetAuthentication()
        {
            return new BrmbleTlsAuthentication(this, _clientCert, (BcTlsCrypto)Crypto);
        }
    }

    internal class BrmbleTlsAuthentication : TlsAuthentication
    {
        private readonly BrmbleTlsClient _client;
        private readonly X509Certificate2 _clientCert;
        private readonly BcTlsCrypto _crypto;

        public BrmbleTlsAuthentication(BrmbleTlsClient client, X509Certificate2 clientCert, BcTlsCrypto crypto)
        {
            _client = client;
            _clientCert = clientCert;
            _crypto = crypto;
        }

        public void NotifyServerCertificate(TlsServerCertificate serverCertificate)
        {
            // Accept all server certificates (same as current ValidateCertificate => true)
        }

        public TlsCredentials GetClientCredentials(BcCertificateRequest certificateRequest)
        {
            if (_clientCert == null)
                return null;

            // Convert .NET cert to BC TLS certificate
            var bcCert = new BcTlsCertificate(_crypto, _clientCert.RawData);
            var chain = new Certificate(new TlsCertificate[] { bcCert });

            // Convert .NET private key to BC asymmetric key
            AsymmetricKeyParameter bcPrivateKey;
            SignatureAndHashAlgorithm sigAlg;

            var rsa = _clientCert.GetRSAPrivateKey();
            if (rsa != null)
            {
                bcPrivateKey = DotNetUtilities.GetRsaKeyPair(rsa).Private;
                sigAlg = new SignatureAndHashAlgorithm(HashAlgorithm.sha256, SignatureAlgorithm.rsa);
            }
            else
            {
                var ecdsa = _clientCert.GetECDsaPrivateKey();
                if (ecdsa != null)
                {
                    // Export ECDSA parameters and construct BC key
                    var ecParams = ecdsa.ExportParameters(true);
                    var oid = new Org.BouncyCastle.Asn1.DerObjectIdentifier(ecParams.Curve.Oid.Value);
                    var x9 = Org.BouncyCastle.Asn1.X9.ECNamedCurveTable.GetByOid(oid);
                    if (x9 == null)
                        return null;

                    var domainParams = new Org.BouncyCastle.Crypto.Parameters.ECDomainParameters(
                        x9.Curve, x9.G, x9.N, x9.H);
                    var d = new Org.BouncyCastle.Math.BigInteger(1, ecParams.D);
                    bcPrivateKey = new Org.BouncyCastle.Crypto.Parameters.ECPrivateKeyParameters(d, domainParams);
                    sigAlg = new SignatureAndHashAlgorithm(HashAlgorithm.sha256, SignatureAlgorithm.ecdsa);
                }
                else
                {
                    return null;
                }
            }

            return new BcDefaultTlsCredentialedSigner(
                new TlsCryptoParameters(_client.TlsContext),
                _crypto,
                bcPrivateKey,
                chain,
                sigAlg);
        }
    }
}
