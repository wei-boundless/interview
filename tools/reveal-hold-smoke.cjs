// Windows integration check: a disposable editor receives the actual native key.
const { app, BrowserWindow, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawn } = require('child_process');
app.setAppPath(path.resolve(__dirname, '..'));
const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mc-global-reveal-qa-'));
process.env.MC_USERDATA = profile;
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ version: 2,
  onboarding: { schemaVersion: 1, completed: true },
  ui: { textOnly: true, outputAutoSize: true, fadeEnabled: true, textOpacity: 0.35, hideTranscript: true, stealth: true },
  asr: { backend: 'cloud' },
}));
fs.writeFileSync(path.join(profile, 'sessions.json'), JSON.stringify({ currentId: 'demo', sessions: [{
  id: 'demo', name: 'QA', createdAt: Date.now(), segments: [], turns: [{ id: 'a', kind: 'free', text: '当前回答完整显示，编辑器中按住查看。', status: 'done' }],
}] }));
const inputScript = path.join(profile, 'test-key.ps1');
fs.writeFileSync(inputScript, `param([long]$Target, [switch]$Gated)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TestKey {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
function Press([int]$Duration, [string]$Name, [bool]$WithShift = $false, [bool]$ShiftFirst = $false) {
 [void][TestKey]::SetForegroundWindow([IntPtr]$Target)
 Start-Sleep -Milliseconds 100
 if ([TestKey]::GetForegroundWindow().ToInt64() -ne $Target) { throw 'Test editor lost focus; no key injected.' }
 try {
  if ($WithShift) { [TestKey]::keybd_event(0x10, 0x2A, 0, [UIntPtr]::Zero) }
  [TestKey]::keybd_event(0xC0, 0x29, 0, [UIntPtr]::Zero)
  [Console]::WriteLine('down-' + $Name); [Console]::Out.Flush()
  Start-Sleep -Milliseconds $Duration
 } finally {
  if ($ShiftFirst) {
   [TestKey]::keybd_event(0x10, 0x2A, 2, [UIntPtr]::Zero)
   [Console]::WriteLine('released-shift'); [Console]::Out.Flush()
   Start-Sleep -Milliseconds 250
  }
  [TestKey]::keybd_event(0xC0, 0x29, 2, [UIntPtr]::Zero)
  if ($WithShift) { [TestKey]::keybd_event(0x10, 0x2A, 2, [UIntPtr]::Zero) }
 }
 [Console]::WriteLine('up-' + $Name); [Console]::Out.Flush()
 if ($Gated) { [void][Console]::ReadLine() }
}
Press 100 'tap'
Start-Sleep -Milliseconds 200
Press 500 'typing'
Start-Sleep -Milliseconds 500
Press 650 'hold' $true
Start-Sleep -Milliseconds 300
Press 650 'shift-first' $true $true
`);
const pause = (ms) => new Promise(r => setTimeout(r, ms));
let first = true;
const timeout = setTimeout(() => { console.error('GLOBAL_REVEAL_TIMEOUT'); app.exit(1); }, 30000);
app.on('browser-window-created', (_event, overlay) => {
  if (!first) return;
  first = false;
  const protectedStates = [];
  const protect = overlay.setContentProtection.bind(overlay);
  overlay.setContentProtection = (value) => { protectedStates.push(value); return protect(value); };
  overlay.webContents.once('did-finish-load', async () => {
    let editor;
    let child;
    try {
      await pause(2500);
      assert(globalShortcut.isRegistered('Shift+`'), 'hold shortcut must be registered globally while fading');
      const opacity = () => overlay.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.turn-body')).opacity`);
      assert.equal(await opacity(), '0.35', 'text-only respects independent fade preference');
      // Regression: typing the shortcut in this app's settings must not latch suppression.
      await overlay.webContents.executeJavaScript('window.__mcOpenSettings()'); await pause(200);
      overlay.show(); overlay.focus(); await pause(300); console.log("QA_FOCUS",overlay.isFocused());
      await overlay.webContents.executeJavaScript(`document.getElementById('hotkeyTextOnly').focus()`);
      const settingsInput = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', inputScript, '-Target', overlay.getNativeWindowHandle().readBigUInt64LE().toString()], { windowsHide: true });
      settingsInput.stderr.on('data', d => console.error(d.toString()));
      const settingsExit = await new Promise(resolve => settingsInput.once('exit', resolve));
      assert.equal(settingsExit, 0);
      assert.equal(await opacity(), '0.35', 'settings input must remain ordinary typing');
      await overlay.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.settings button')).find(b=>b.textContent==='取消').click()`);
      await pause(200);
      editor = new BrowserWindow({ width: 450, height: 300, title: 'Disposable editor QA', webPreferences: { nodeIntegration: false, contextIsolation: true } });
      await editor.loadURL('data:text/html,<textarea autofocus style="width:95%;height:85%"></textarea><script>window.keys=[];document.addEventListener("keydown",e=>window.keys.push(e.code));</script>');
      overlay.on('focus',()=>console.log('QA overlay focused'));
      editor.on('blur',()=>console.log('QA editor blurred'));
      editor.focus(); await pause(300);
      assert(editor.isFocused()); assert(!overlay.isFocused());
      const handle = editor.getNativeWindowHandle().readBigUInt64LE().toString();
      child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', inputScript, '-Target', handle, '-Gated'], { windowsHide: true });
      let output = '';
      let errors = '';
      child.stdout.on('data', d => { output += d.toString(); });
      child.stderr.on('data', d => { errors += d.toString(); });
      const waitFor = async (marker) => {
        for (let i = 0; i < 100 && !output.includes(marker); i++) { if (errors) throw new Error(errors); await pause(30); }
        assert(output.includes(marker), marker + ' missing: ' + errors);
      };
      await waitFor('up-tap');
      assert.equal(await opacity(), '0.35', 'normal typing must not reveal');
      child.stdin.write('next\n');
      await waitFor('down-typing'); await pause(350);
      assert.equal(await opacity(), '0.35', 'even holding backquote alone must not reveal');
      await waitFor('up-typing'); child.stdin.write('next\n');
      const typedBeforeHold = await editor.webContents.executeJavaScript('document.querySelector("textarea").value');
      await waitFor('down-hold'); await pause(180);
      assert.equal(await opacity(), '1', 'hold from another app reveals');
      assert(editor.isFocused(), 'reveal must not steal editor focus');
      await waitFor('up-hold'); await pause(100);
      assert.equal(await opacity(), '0.35', 'release restores fade');
      child.stdin.write('next\n');
      await waitFor('down-shift-first'); await pause(180);
      assert.equal(await opacity(), '1');
      await waitFor('released-shift'); await pause(100);
      assert.equal(await opacity(), '0.35', 'releasing Shift first restores fade');
      await waitFor('up-shift-first'); child.stdin.write('next\n');
      assert.equal(await editor.webContents.executeJavaScript('document.querySelector("textarea").value'), typedBeforeHold,
        'registered hold shortcut must not type into the editor');
      assert((await editor.webContents.executeJavaScript('window.keys')).includes('Backquote'), 'typing is not consumed');
      assert.deepEqual(protectedStates, [true]);
      await overlay.webContents.executeJavaScript('window.mc.setSettings({ui:{fadeEnabled:false}})'); await pause(150);
      assert.equal(globalShortcut.isRegistered('Shift+`'), false, 'turning fading off releases the shortcut');
      await overlay.webContents.executeJavaScript('window.mc.setSettings({ui:{fadeEnabled:true}})'); await pause(150);
      assert.equal(globalShortcut.isRegistered('Shift+`'), true, 'turning fading on restores the shortcut');
      await overlay.webContents.executeJavaScript('window.mc.hide()'); await pause(150);
      assert.equal(overlay.getOpacity(), 0);
      assert.equal(globalShortcut.isRegistered('Shift+`'), false, 'hidden window releases global shortcut');
      // Deliberate holds while hidden cannot reveal or show the window.
      const second = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', inputScript, '-Target', handle], { windowsHide: true });
      await new Promise(resolve => second.once('exit', resolve));
      assert.equal(overlay.getOpacity(), 0);
      console.log('GLOBAL_REVEAL_HOLD_OK');
      clearTimeout(timeout); app.quit();
    } catch (error) {
      console.error(error); child?.kill(); editor?.destroy(); clearTimeout(timeout); app.emit('before-quit'); app.exit(1);
    }
  });
});
require(path.resolve(__dirname, '../out/main/index.js'));
