namespace Brmble.Server.Matrix;

public class MatrixAppService
{
    private readonly IHttpClientFactory _httpClientFactory;

    public MatrixAppService(IHttpClientFactory httpClientFactory)
    {
        _httpClientFactory = httpClientFactory;
    }

    // TODO: PostAsBot(string roomId, string text)
    //   PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
    //   Authorization: Bearer <as_token>
    //   Body: { msgtype: "m.text", body: text }
}
