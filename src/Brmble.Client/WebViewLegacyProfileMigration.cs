namespace Brmble.Client;

internal static class WebViewLegacyProfileMigration
{
    public static bool TryMigrate(string stableProfile, IReadOnlyList<string> legacyProfiles)
    {
        if (Directory.Exists(stableProfile)) return true;

        foreach (var legacyProfile in legacyProfiles)
        {
            if (!Directory.Exists(legacyProfile)) continue;

            var temporaryProfile = stableProfile + ".migration-" + Guid.NewGuid().ToString("N");
            try
            {
                CopyDirectory(legacyProfile, temporaryProfile);
                Directory.Move(temporaryProfile, stableProfile);
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                try
                {
                    if (Directory.Exists(temporaryProfile))
                        Directory.Delete(temporaryProfile, recursive: true);
                }
                catch { }
            }
        }

        return true;
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);

        foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));
        }

        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)), overwrite: false);
        }
    }
}
