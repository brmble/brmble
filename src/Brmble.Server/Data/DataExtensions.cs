namespace Brmble.Server.Data;

public static class DataExtensions
{
    public static IServiceCollection AddDatabase(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Default") ?? "Data Source=brmble.db";
        services.AddSingleton(_ =>
        {
            var db = new Database(connectionString);
            db.Initialize();
            return db;
        });
        return services;
    }
}
