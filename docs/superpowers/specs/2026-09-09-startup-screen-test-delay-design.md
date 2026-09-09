# Startup Screen Test Delay Design

## Goal

Make the startup loading screen easy to inspect manually without slowing normal Brmble startup.

## Design

`Brmble.Client` will recognize the optional `BRMBLE_STARTUP_DELAY_SECONDS` environment variable. After navigating to `startup.html` in loading mode, it will wait for the requested positive number of seconds before continuing native initialization. The variable is intended only for local testing and has no effect when absent.

`Brmble-Run.bat` will offer three choices: normal launch, a five-second loading-screen preview that sets the environment variable, and the existing failure-screen test that removes the packaged main HTML temporarily. The batch file restores any temporarily renamed file after the client exits.

## Safety and verification

The delay is opt-in and bounded to a small test value by the launcher. Existing normal startup and error handling remain unchanged. Verify the client build and confirm the launcher’s loading-preview path sets the variable while the normal path does not.
