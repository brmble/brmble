namespace Brmble.Server.Messages;

public static class MessageDeletionExtensions
{
    public static IServiceCollection AddMessageDeletion(this IServiceCollection services)
    {
        services.AddSingleton<MessageDeletionPolicy>();
        services.AddSingleton<MessageDeletionRepository>();
        services.AddSingleton<MessageDeletionService>();
        return services;
    }
}
