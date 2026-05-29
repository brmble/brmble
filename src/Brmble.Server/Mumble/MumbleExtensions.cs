using Brmble.Server.Events;
using Brmble.Server.ChannelRequests;

namespace Brmble.Server.Mumble;

public static class MumbleExtensions
{
    public static IServiceCollection AddMumble(this IServiceCollection services)
    {
        services.AddOptions<IceSettings>()
            .BindConfiguration("Ice");
        services.AddSingleton<ISessionMappingService, SessionMappingService>();
        services.AddSingleton<IChannelMembershipService, ChannelMembershipService>();
        services.AddSingleton<IBrmbleEventBus, BrmbleEventBus>();
        services.AddSingleton<IMumbleEventHandler, SessionMappingHandler>();
        services.AddSingleton<MumbleRegistrationService>();
        services.AddSingleton<IMumbleRegistrationService>(sp => sp.GetRequiredService<MumbleRegistrationService>());
        services.AddSingleton<MumbleAclIceClient>();
        services.AddSingleton<IMumbleAclIceClient>(sp => sp.GetRequiredService<MumbleAclIceClient>());
        services.AddSingleton<IMumbleAclService, MumbleAclService>();
        services.AddSingleton<IAclSnapshotRepository, AclSnapshotRepository>();
        services.AddSingleton<IAclAuthorizationService, AclAuthorizationService>();
        services.AddSingleton<IAclEventDispatcher, AclEventDispatcher>();
        services.AddSingleton<IAclSyncCoordinator, AclSyncCoordinator>();
        services.AddSingleton<AclValidationService>();
        services.AddScoped<IChannelRequestRepository, ChannelRequestRepository>();
        services.AddScoped<IChannelRequestMumbleService, ChannelRequestMumbleService>();
        services.AddScoped<ChannelRequestService>();
        services.AddSingleton<MumbleServerCallback>();
        services.AddSingleton<IMumbleIceCommunicatorFactory, MumbleIceCommunicatorFactory>();
        services.AddHostedService<MumbleIceService>();
        return services;
    }
}
