# Solution Structure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold the Brmble repository with a single .sln, all project files, shared build props, and a React+Vite frontend so everything compiles and runs.

**Architecture:** Single solution containing an ASP.NET Core backend, a raw Win32+WebView2 desktop client, and two existing libraries (MumbleSharp, MumbleVoiceEngine). A separate React+Vite project lives alongside for the web UI.

**Tech Stack:** .NET 10, ASP.NET Core, YARP, WebView2, React, Vite, TypeScript

---

### Task 1: Create Directory.Build.props and isolate MumbleSharp

**Files:**
- Create: `Directory.Build.props`
- Create: `lib/MumbleSharp/Directory.Build.props`

**Step 1: Create root Directory.Build.props**

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

This sets shared defaults for all C# projects. Individual projects can override (e.g., Client overrides TFM to `net10.0-windows`).

**Step 2: Block inheritance for MumbleSharp**

Create `lib/MumbleSharp/Directory.Build.props`:

```xml
<Project>
  <!-- Block root Directory.Build.props — MumbleSharp manages its own build settings -->
</Project>
```

MumbleSharp targets netstandard2.0/2.1 and doesn't compile with `Nullable=enable`. This empty file stops MSBuild from walking up to the root.

**Step 3: Commit**

```bash
git add Directory.Build.props lib/MumbleSharp/Directory.Build.props
git commit -m "Add shared build props, isolate MumbleSharp from inheritance"
```

---

### Task 2: Update MumbleVoiceEngine.csproj to inherit shared props

**Files:**
- Modify: `lib/MumbleVoiceEngine/MumbleVoiceEngine.csproj`

**Step 1: Remove properties now inherited from root**

Remove `TargetFramework`, `ImplicitUsings`, and `Nullable` — they come from Directory.Build.props. Keep `AllowUnsafeBlocks` (project-specific).

Updated file:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="NAudio.WinMM" Version="2.1.0" />
  </ItemGroup>

  <ItemGroup Label="NativeLibraries">
    <Content Include="Native\opus.dll" Link="opus.dll" CopyToOutputDirectory="Always" />
    <Content Include="Native\speexdsp.dll" Link="speexdsp.dll" CopyToOutputDirectory="Always" />
  </ItemGroup>
</Project>
```

**Step 2: Commit**

```bash
git add lib/MumbleVoiceEngine/MumbleVoiceEngine.csproj
git commit -m "Simplify MumbleVoiceEngine csproj, inherit shared props"
```

---

### Task 3: Update MumbleVoiceEngine.Tests.csproj to inherit shared props

**Files:**
- Modify: `tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj`

**Step 1: Remove inherited properties, keep test-specific ones**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.7.3" />
    <PackageReference Include="MSTest.TestFramework" Version="3.7.3" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\lib\MumbleVoiceEngine\MumbleVoiceEngine.csproj" />
  </ItemGroup>
</Project>
```

**Step 2: Verify existing tests still pass**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj
git commit -m "Simplify test csproj, inherit shared props"
```

---

### Task 4: Create Brmble.Server project

**Files:**
- Create: `src/Brmble.Server/Brmble.Server.csproj`
- Create: `src/Brmble.Server/Program.cs`

**Step 1: Create the project file**

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="Yarp.ReverseProxy" Version="2.3.0" />
  </ItemGroup>
</Project>
```

Inherits `net10.0`, `Nullable`, `ImplicitUsings` from root. Uses `Sdk.Web` for ASP.NET Core.

**Step 2: Create minimal Program.cs**

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

app.MapReverseProxy();

app.Run();
```

**Step 3: Verify it builds and runs**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded

Run: `dotnet run --project src/Brmble.Server/Brmble.Server.csproj -- --urls http://localhost:5100`
Then: `curl http://localhost:5100/health`
Expected: `{"status":"healthy"}`

**Step 4: Commit**

```bash
git add src/Brmble.Server/
git commit -m "Add Brmble.Server skeleton with health endpoint and YARP stub"
```

---

### Task 5: Create Brmble.Client project

**Files:**
- Create: `src/Brmble.Client/Brmble.Client.csproj`
- Create: `src/Brmble.Client/Program.cs`
- Create: `src/Brmble.Client/Win32Window.cs`

**Step 1: Create the project file**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0-windows</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Web.WebView2" Version="1.0.3124.44" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\lib\MumbleSharp\MumbleSharp\MumbleSharp.csproj" />
    <ProjectReference Include="..\..\lib\MumbleVoiceEngine\MumbleVoiceEngine.csproj" />
  </ItemGroup>
</Project>
```

Overrides TFM to `net10.0-windows` (required for Win32 APIs and WebView2).

**Step 2: Create Win32Window.cs — raw Win32 window via P/Invoke**

```csharp
using System.Runtime.InteropServices;

namespace Brmble.Client;

internal static class Win32Window
{
    private const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    private const uint WS_VISIBLE = 0x10000000;
    private const int CW_USEDEFAULT = unchecked((int)0x80000000);
    private const uint CS_HREDRAW = 0x0002;
    private const uint CS_VREDRAW = 0x0001;

    public const uint WM_DESTROY = 0x0002;
    public const uint WM_SIZE = 0x0005;

    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEX
    {
        public uint cbSize;
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassEx(ref WNDCLASSEX lpwcx);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowEx(
        uint exStyle, string className, string windowName, uint style,
        int x, int y, int width, int height,
        IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);

    [DllImport("user32.dll")]
    public static extern bool GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);

    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG msg);

    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessage(ref MSG msg);

    [DllImport("user32.dll")]
    public static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll")]
    public static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadCursor(IntPtr instance, int cursorName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);

    private static WndProc? _wndProcRef; // prevent GC of delegate

    public static IntPtr Create(string className, string title, int width, int height, WndProc wndProc)
    {
        var hInstance = GetModuleHandle(null);
        _wndProcRef = wndProc;

        var wc = new WNDCLASSEX
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEX>(),
            style = CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc = _wndProcRef,
            hInstance = hInstance,
            hCursor = LoadCursor(IntPtr.Zero, 32512),
            lpszClassName = className
        };
        RegisterClassEx(ref wc);

        return CreateWindowEx(0, className, title,
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT, CW_USEDEFAULT, width, height,
            IntPtr.Zero, IntPtr.Zero, hInstance, IntPtr.Zero);
    }

    public static void RunMessageLoop()
    {
        while (GetMessage(out var msg, IntPtr.Zero, 0, 0))
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }
}
```

**Step 3: Create Program.cs — entry point with WebView2 init**

```csharp
using System.Drawing;
using Microsoft.Web.WebView2.Core;

namespace Brmble.Client;

static class Program
{
    private static CoreWebView2Controller? _controller;

    [STAThread]
    static void Main()
    {
        var hwnd = Win32Window.Create("BrmbleWindow", "Brmble", 1280, 720, WndProc);
        _ = InitWebView2Async(hwnd);
        Win32Window.RunMessageLoop();
    }

    private static async Task InitWebView2Async(IntPtr hwnd)
    {
        var env = await CoreWebView2Environment.CreateAsync();
        _controller = await env.CreateCoreWebView2ControllerAsync(hwnd);

        Win32Window.GetClientRect(hwnd, out var rect);
        _controller.Bounds = new Rectangle(0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top);
        _controller.IsVisible = true;

        _controller.CoreWebView2.NavigateToString(
            "<html><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0'><h1>Brmble</h1></body></html>");
    }

    private static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        switch (msg)
        {
            case Win32Window.WM_SIZE:
                if (_controller != null)
                {
                    Win32Window.GetClientRect(hwnd, out var rect);
                    _controller.Bounds = new Rectangle(0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top);
                }
                return IntPtr.Zero;

            case Win32Window.WM_DESTROY:
                Win32Window.PostQuitMessage(0);
                return IntPtr.Zero;

            default:
                return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
        }
    }
}
```

**Step 4: Verify it builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 5: Commit**

```bash
git add src/Brmble.Client/
git commit -m "Add Brmble.Client skeleton with raw Win32 WebView2 host"
```

---

### Task 6: Create Brmble.sln and add all projects

**Step 1: Create solution and add projects**

```bash
cd C:/dev/brmble/brmble
dotnet new sln --name Brmble
dotnet sln Brmble.sln add src/Brmble.Server/Brmble.Server.csproj
dotnet sln Brmble.sln add src/Brmble.Client/Brmble.Client.csproj
dotnet sln Brmble.sln add lib/MumbleSharp/MumbleSharp/MumbleSharp.csproj
dotnet sln Brmble.sln add lib/MumbleVoiceEngine/MumbleVoiceEngine.csproj
dotnet sln Brmble.sln add tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj
```

**Step 2: Verify full solution builds**

Run: `dotnet build Brmble.sln`
Expected: Build succeeded (all 5 projects)

**Step 3: Verify existing tests pass**

Run: `dotnet test Brmble.sln`
Expected: All MumbleVoiceEngine tests pass

**Step 4: Commit**

```bash
git add Brmble.sln
git commit -m "Add Brmble.sln with all projects"
```

---

### Task 7: Scaffold Brmble.Web (React + Vite + TypeScript)

**Step 1: Create the Vite project**

```bash
cd C:/dev/brmble/brmble/src
npm create vite@latest Brmble.Web -- --template react-ts
```

**Step 2: Install dependencies**

```bash
cd C:/dev/brmble/brmble/src/Brmble.Web
npm install
```

**Step 3: Verify dev server starts**

```bash
npm run dev
```

Expected: Vite dev server starts on localhost, shows default React page.

**Step 4: Verify production build**

```bash
npm run build
```

Expected: Build succeeds, output in `dist/`.

**Step 5: Commit**

```bash
git add src/Brmble.Web/
git commit -m "Scaffold Brmble.Web with React + Vite + TypeScript"
```

---

### Task 8: Final verification of all success criteria

Run each check and confirm:

1. `dotnet build Brmble.sln` — all 5 C# projects compile, zero errors
2. `dotnet run --project src/Brmble.Server -- --urls http://localhost:5100` then `curl http://localhost:5100/health` — returns `{"status":"healthy"}`
3. `dotnet run --project src/Brmble.Client` — Win32 window opens with WebView2 showing "Brmble"
4. `cd src/Brmble.Web && npm run dev` — Vite dev server starts
5. `dotnet test Brmble.sln` — existing MumbleVoiceEngine tests pass

If any fail, fix and amend the relevant commit before proceeding.
