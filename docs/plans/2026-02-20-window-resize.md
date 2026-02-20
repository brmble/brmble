# Window Resize Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the frameless Win32 window resizable by adding WM_NCHITTEST and WM_GETMINMAXINFO handlers, with a minimum window size of 600×400.

**Architecture:** A pure static `HitTestHelper.Calculate` method handles the border-detection math (testable without Win32). The WndProc in Program.cs calls it via the new WM_NCHITTEST case. A WM_GETMINMAXINFO case sets the minimum track size.

**Tech Stack:** C# Win32 P/Invoke, MSTest, .NET 10 Windows

---

### Task 1: Add HitTestHelper pure class to Brmble.Client

**Files:**
- Create: `src/Brmble.Client/HitTestHelper.cs`

This is a pure static class — no P/Invoke, no Win32. Keeps the testable math separate.

**Step 1: Create the file**

```csharp
namespace Brmble.Client;

/// <summary>
/// Pure hit-test calculation for resize border detection.
/// Extracted for testability — no Win32 dependencies.
/// </summary>
public static class HitTestHelper
{
    public const int HtClient      = 1;
    public const int HtLeft        = 10;
    public const int HtRight       = 11;
    public const int HtTop         = 12;
    public const int HtTopLeft     = 13;
    public const int HtTopRight    = 14;
    public const int HtBottom      = 15;
    public const int HtBottomLeft  = 16;
    public const int HtBottomRight = 17;

    /// <summary>
    /// Returns a WM_NCHITTEST hit code for cursor position (x, y) inside a
    /// client rect of given width/height, using the specified border width (px).
    /// </summary>
    public static int Calculate(int x, int y, int width, int height, int borderWidth)
    {
        bool left   = x < borderWidth;
        bool right  = x >= width - borderWidth;
        bool top    = y < borderWidth;
        bool bottom = y >= height - borderWidth;

        if (top    && left)  return HtTopLeft;
        if (top    && right) return HtTopRight;
        if (bottom && left)  return HtBottomLeft;
        if (bottom && right) return HtBottomRight;
        if (top)             return HtTop;
        if (bottom)          return HtBottom;
        if (left)            return HtLeft;
        if (right)           return HtRight;
        return HtClient;
    }
}
```

**Step 2: Build to verify it compiles**

Run: `dotnet build src/Brmble.Client`
Expected: Build succeeded, 0 errors

**Step 3: Commit**

```bash
git add src/Brmble.Client/HitTestHelper.cs
git commit -m "feat: add HitTestHelper pure class for window resize hit testing"
```

---

### Task 2: Create Brmble.Client.Tests project and write unit tests

**Files:**
- Create: `tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
- Create: `tests/Brmble.Client.Tests/HitTestHelperTests.cs`

**Step 1: Create the csproj**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0-windows</TargetFramework>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.7.3" />
    <PackageReference Include="MSTest.TestFramework" Version="3.7.3" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\src\Brmble.Client\Brmble.Client.csproj" />
  </ItemGroup>
</Project>
```

**Step 2: Write failing tests**

```csharp
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client;

namespace Brmble.Client.Tests;

[TestClass]
public class HitTestHelperTests
{
    // Window: 800 wide, 600 tall, border: 6px

    [TestMethod] public void Center_ReturnsClient()
        => Assert.AreEqual(HitTestHelper.HtClient, HitTestHelper.Calculate(400, 300, 800, 600, 6));

    [TestMethod] public void TopEdge_ReturnsTop()
        => Assert.AreEqual(HitTestHelper.HtTop, HitTestHelper.Calculate(400, 3, 800, 600, 6));

    [TestMethod] public void BottomEdge_ReturnsBottom()
        => Assert.AreEqual(HitTestHelper.HtBottom, HitTestHelper.Calculate(400, 597, 800, 600, 6));

    [TestMethod] public void LeftEdge_ReturnsLeft()
        => Assert.AreEqual(HitTestHelper.HtLeft, HitTestHelper.Calculate(3, 300, 800, 600, 6));

    [TestMethod] public void RightEdge_ReturnsRight()
        => Assert.AreEqual(HitTestHelper.HtRight, HitTestHelper.Calculate(797, 300, 800, 600, 6));

    [TestMethod] public void TopLeftCorner_ReturnsTopLeft()
        => Assert.AreEqual(HitTestHelper.HtTopLeft, HitTestHelper.Calculate(2, 2, 800, 600, 6));

    [TestMethod] public void TopRightCorner_ReturnsTopRight()
        => Assert.AreEqual(HitTestHelper.HtTopRight, HitTestHelper.Calculate(797, 2, 800, 600, 6));

    [TestMethod] public void BottomLeftCorner_ReturnsBottomLeft()
        => Assert.AreEqual(HitTestHelper.HtBottomLeft, HitTestHelper.Calculate(2, 597, 800, 600, 6));

    [TestMethod] public void BottomRightCorner_ReturnsBottomRight()
        => Assert.AreEqual(HitTestHelper.HtBottomRight, HitTestHelper.Calculate(797, 597, 800, 600, 6));

    [TestMethod] public void ExactlyAtBorder_ReturnsEdge()
        => Assert.AreEqual(HitTestHelper.HtLeft, HitTestHelper.Calculate(5, 300, 800, 600, 6));

    [TestMethod] public void JustInsideBorder_ReturnsClient()
        => Assert.AreEqual(HitTestHelper.HtClient, HitTestHelper.Calculate(6, 300, 800, 600, 6));
}
```

**Step 3: Run tests — expect PASS (logic already written in Task 1)**

Run: `dotnet test tests/Brmble.Client.Tests`
Expected: 11 tests pass

> Note: If you get a build error about referencing a WinExe project, check that Brmble.Client.csproj has `<OutputType>WinExe</OutputType>`. This is fine — .NET 5+ supports referencing WinExe from test projects.

**Step 4: Commit**

```bash
git add tests/Brmble.Client.Tests/
git commit -m "test: add unit tests for HitTestHelper"
```

---

### Task 3: Add Win32 structs and P/Invokes to Win32Window.cs

**Files:**
- Modify: `src/Brmble.Client/Win32Window.cs`

The POINT and MINMAXINFO structs are needed for WM_NCHITTEST and WM_GETMINMAXINFO. Add these alongside the existing structs (after the RECT struct, around line 65).

**Step 1: Add POINT struct** (after the RECT struct)

```csharp
[StructLayout(LayoutKind.Sequential)]
public struct POINT
{
    public int X, Y;
}
```

**Step 2: Add MINMAXINFO struct** (after POINT)

```csharp
[StructLayout(LayoutKind.Sequential)]
public struct MINMAXINFO
{
    public POINT ptReserved;
    public POINT ptMaxSize;
    public POINT ptMaxPosition;
    public POINT ptMinTrackSize;
    public POINT ptMaxTrackSize;
}
```

**Step 3: Add constants** (in the existing constants block near the top)

```csharp
public const uint WM_NCHITTEST      = 0x0084;
public const uint WM_GETMINMAXINFO  = 0x0024;
```

**Step 4: Add P/Invoke declarations** (with the other DllImport declarations)

```csharp
[DllImport("user32.dll")]
public static extern bool GetCursorPos(out POINT lpPoint);

[DllImport("user32.dll")]
public static extern bool ScreenToClient(IntPtr hwnd, ref POINT lpPoint);
```

**Step 5: Build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: Build succeeded, 0 errors

**Step 6: Commit**

```bash
git add src/Brmble.Client/Win32Window.cs
git commit -m "feat: add POINT, MINMAXINFO structs and hit-test P/Invokes to Win32Window"
```

---

### Task 4: Add WM_NCHITTEST and WM_GETMINMAXINFO handlers to WndProc

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

Add two new cases to the `switch (msg)` block in `WndProc`. Add them BEFORE the default `return Win32Window.DefWindowProc(...)` call, after the existing cases.

**Step 1: Add WM_NCHITTEST case**

Add this case to the switch block in WndProc:

```csharp
case Win32Window.WM_NCHITTEST:
{
    Win32Window.GetCursorPos(out var pt);
    Win32Window.ScreenToClient(hwnd, ref pt);
    Win32Window.GetClientRect(hwnd, out var rect);
    var width = rect.Right - rect.Left;
    var height = rect.Bottom - rect.Top;
    var hit = HitTestHelper.Calculate(pt.X, pt.Y, width, height, borderWidth: 6);
    return (IntPtr)hit;
}
```

**Step 2: Add WM_GETMINMAXINFO case**

Add this case to the switch block, after WM_NCHITTEST:

```csharp
case Win32Window.WM_GETMINMAXINFO:
{
    var info = Marshal.PtrToStructure<Win32Window.MINMAXINFO>(lParam);
    info.ptMinTrackSize = new Win32Window.POINT { X = 600, Y = 400 };
    Marshal.StructureToPtr(info, lParam, false);
    return IntPtr.Zero;
}
```

**Step 3: Verify Marshal is available** — `System.Runtime.InteropServices` is already imported at the top of Win32Window.cs. Confirm `using System.Runtime.InteropServices;` is also present in Program.cs (it imports `using System.Drawing;` so check the full list). If missing, add it.

**Step 4: Build**

Run: `dotnet build src/Brmble.Client`
Expected: Build succeeded, 0 errors

**Step 5: Run all tests**

Run: `dotnet test`
Expected: all tests pass

**Step 6: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: add WM_NCHITTEST and WM_GETMINMAXINFO for window resize support"
```

---

### Task 5: Manual verification

Start the app in dev mode:

```bash
# Terminal 1
cd src/Brmble.Web && npm run dev

# Terminal 2
dotnet run --project src/Brmble.Client
```

Verify each of these:

- [ ] Drag left edge — window resizes
- [ ] Drag right edge — window resizes
- [ ] Drag top edge — window resizes
- [ ] Drag bottom edge — window resizes
- [ ] Drag top-left corner — diagonal resize
- [ ] Drag top-right corner — diagonal resize
- [ ] Drag bottom-left corner — diagonal resize
- [ ] Drag bottom-right corner — diagonal resize
- [ ] Try to make window smaller than 600×400 — it stops
- [ ] Maximize button still works
- [ ] Restore button after maximize works
- [ ] Drag header to move window — still works
- [ ] Click buttons and interact with UI — no hit-test interference
