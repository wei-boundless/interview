param([int]$ParentProcessId)
$ErrorActionPreference = 'Stop'
# Only the backquote key and modifier states are inspected. No text is captured.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RevealHoldKey {
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    private static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    public static bool Read() {
        return Down(0xC0) && Down(0x10) && !Down(0x11) && !Down(0x12) && !Down(0x5B) && !Down(0x5C);
    }
}
'@
$parent = [System.Diagnostics.Process]::GetProcessById($ParentProcessId)
while (-not $parent.HasExited) {
    if ([RevealHoldKey]::Read()) { [Console]::Out.WriteLine('1') }
    else { [Console]::Out.WriteLine('0') }
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 25
}
