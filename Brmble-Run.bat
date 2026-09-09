@echo off
setlocal

rem Run from the repository root no matter where this file is launched from.
set "ROOT=%~dp0"
pushd "%ROOT%" || exit /b 1

echo Building frontend...
cd /d "%ROOT%src\Brmble.Web" || goto :error
call npm install || goto :error
call npm run build || goto :error

echo Building client...
cd /d "%ROOT%" || goto :error
dotnet build src\Brmble.Client\Brmble.Client.csproj -c Debug || goto :error

echo Starting client...
cd /d "%ROOT%" || goto :error
echo.
echo [N] Normal launch
echo [L] Loading preview (5-second startup delay)
echo [F] Failure preview (forces the branded failure page)
choice /c NLF /n /m "Choose N, L, or F: "
if errorlevel 3 goto :failure_preview
if errorlevel 2 goto :loading_preview

dotnet run --no-build --project src\Brmble.Client -c Debug
set "EXIT_CODE=%ERRORLEVEL%"

popd
exit /b %EXIT_CODE%

:loading_preview
echo.
echo Launching the loading preview...
set "BRMBLE_STARTUP_DELAY_SECONDS=5"
dotnet run --no-build --project "%ROOT%src\Brmble.Client\Brmble.Client.csproj" -c Debug
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Loading preview client exited with code %EXIT_CODE%.
echo Press any key to close this window.
pause >nul

popd
exit /b %EXIT_CODE%

:failure_preview
set "WEBROOT=%ROOT%src\Brmble.Client\bin\Debug\net10.0-windows\web"
set "CLIENTEXE=%ROOT%src\Brmble.Client\bin\Debug\net10.0-windows\Brmble.Client.exe"
set "MAINHTML=%WEBROOT%\index.html"
set "DISABLEDHTML=%WEBROOT%\index.html.disabled"
if not exist "%MAINHTML%" goto :error
if not exist "%CLIENTEXE%" goto :error
if exist "%DISABLEDHTML%" goto :error

echo.
echo Launching the failure preview...
move /y "%MAINHTML%" "%DISABLEDHTML%" >nul || goto :error
pushd "%WEBROOT%" || goto :error
dotnet run --no-build --project "%ROOT%src\Brmble.Client\Brmble.Client.csproj" -c Debug
set "EXIT_CODE=%ERRORLEVEL%"
popd
move /y "%DISABLEDHTML%" "%MAINHTML%" >nul

echo.
echo Failure preview client exited with code %EXIT_CODE%.
echo Press any key to close this window.
pause >nul

popd
exit /b %EXIT_CODE%

:error
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Brmble failed to start. Error code: %EXIT_CODE%
echo Press any key to close this window.
pause >nul
popd
exit /b %EXIT_CODE%
