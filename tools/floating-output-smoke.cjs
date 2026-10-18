// Run after npm run build: electron tools/floating-output-smoke.cjs.
// Uses an isolated profile and simulated cursor; never edits the real user's data.
const { app, screen, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
app.setAppPath(path.resolve(__dirname, '..'));
const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mc-floating-qa-'));
process.env.MC_USERDATA = profile;
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ version: 2,
  onboarding: { schemaVersion: 1, completed: true },
  ui: { textOnly: true, hideTranscript: true, stealth: true, fadeEnabled: false }, asr: { backend: 'cloud' },
}));
const paragraph = '固定悬浮输出会根据窗口宽度自然换行，保持字号，保留原来的隐身保护。';
fs.writeFileSync(path.join(profile, 'sessions.json'), JSON.stringify({ currentId: 'demo', sessions: [{
  id: 'demo', name: 'QA', createdAt: Date.now(), segments: [], turns: [
    { id: 'one', kind: 'free', text: paragraph.repeat(6), status: 'done' },
    { id: 'two', kind: 'free', text: 'https://example.test/' + 'longword'.repeat(50), status: 'done' },
  ],
}] }));
let cursor = { x: -100000, y: -100000 };
app.whenReady().then(() => { screen.getCursorScreenPoint = () => cursor; });
const shortcuts = new Map();
const register = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (key, callback) => { shortcuts.set(key, callback); return register(key, callback); };
const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('FLOATING_QA_TIMEOUT'); app.exit(1); }, 45000);
app.on('browser-window-created', (_event, win) => {
  let ignored;
  const protection = [];
  const boundsCalls = [];
  const setBounds = win.setBounds.bind(win);
  win.setBounds = (bounds, ...args) => { boundsCalls.push(bounds); return setBounds(bounds, ...args); };
  const ignore = win.setIgnoreMouseEvents.bind(win);
  win.setIgnoreMouseEvents = (value, options) => { ignored = value; return ignore(value, options); };
  const protect = win.setContentProtection.bind(win);
  win.setContentProtection = (value) => { protection.push(value); return protect(value); };
  const js = (code) => win.webContents.executeJavaScript(code);
  win.webContents.once('did-finish-load', async () => {
    try {
      await pause(900);
      const original = win.getBounds();
      assert.equal(ignored, true, 'ordinary text-only mode also passes output clicks through');
      const openSettings = async () => { await js('window.__mcOpenSettings()'); await pause(); };
      const select = async (id, value) => {
        await js(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await pause(80);
      };
      const save = async () => {
        await js(`Array.from(document.querySelectorAll('.settings button')).find(b=>b.textContent.includes('仅应用显示设置')).click()`);
        await pause(400);
      };
      await openSettings();
      await select('text-only', 'text');
      await save();
      assert.equal(await js(`document.querySelector('.app').classList.contains('app-text-only')`), true);
      assert.deepEqual(win.getBounds(), original, 'fixed-window mode must not change window bounds');
      assert.equal(ignored, true);
      win.setSize(800, 560); await pause();
      const wide = await js(`document.querySelectorAll('.turn-body')[1].getBoundingClientRect().height`);
      win.setSize(300, 560); await pause();
      assert(Math.abs(win.getBounds().width - 300) <= 2, 'text-only window accepts 300px width');
      const narrow = await js(`document.querySelectorAll('.turn-body')[1].getBoundingClientRect().height`);
      assert(narrow > wide, 'text must reflow rather than shrink its font');
      assert.equal(await js(`(()=>{const a=document.querySelectorAll('.turn');const box=document.querySelector('.session');return a[0].getBoundingClientRect().bottom<=a[1].getBoundingClientRect().top && box.scrollWidth<=box.clientWidth})()`), true);
      assert.equal(await js(`(()=>{const body=document.querySelector('.turn-body').getBoundingClientRect();return body.left>=0&&body.right<=innerWidth})()`), true, 'text stays within the narrow window');
      const bounds = win.getBounds();
      cursor = { x: bounds.x + 200, y: bounds.y + 10 }; await pause(); assert.equal(ignored, true);
      assert.equal(await js(`document.querySelector('.titlebar').classList.contains('toolbar-revealed')`), false);
      cursor = { x: bounds.x + 20, y: bounds.y + 10 }; await pause(); assert.equal(ignored, false);
      await js(`document.querySelector('.text-only-trigger').dispatchEvent(new MouseEvent('mouseenter'))`);
      await pause(450); assert.equal(await js(`document.querySelector('.titlebar').classList.contains('toolbar-revealed')`), false);
      await js(`document.querySelector('.text-only-trigger').click()`);
      await pause(100); assert.equal(await js(`document.querySelector('.titlebar').classList.contains('toolbar-revealed')`), true);
      assert.equal(await js(`(()=>{const panel=document.querySelector('.titlebar-actions').getBoundingClientRect();const buttons=[...document.querySelectorAll('.display-toggles button')].map(e=>e.getBoundingClientRect());return panel.left>=0&&panel.right<=innerWidth&&buttons.every(b=>b.left>=panel.left&&b.right<=panel.right&&b.bottom<=innerHeight)&&buttons.every((b,i)=>i===0||buttons[i-1].right<=b.left)})()`),true,'display toggles fit the compact toolbar');
      fs.writeFileSync(path.join(profile, 'toolbar.png'), (await win.webContents.capturePage()).toPNG());
      cursor = { x: bounds.x + 200, y: bounds.y + 10 };
      await pause(); assert.equal(ignored, false, 'revealed toolbar stays interactive while crossing to its buttons');
      await js(`document.querySelector('.titlebar').dispatchEvent(new MouseEvent('mouseleave'))`);
      await pause(); assert.equal(ignored, true);
      cursor = { x: bounds.x + 20, y: bounds.y + 180 }; await pause(); assert.equal(ignored, true);
      await js('window.mc.setOverlayInteraction(true)'); await pause(); assert.equal(ignored, false);
      await js('window.mc.hide()'); await pause();
      assert.equal(win.getOpacity(), 0); assert.equal(ignored, true);
      await js('window.mc.setOverlayInteraction(true)'); await pause(); assert.equal(ignored, true);
      shortcuts.get('Control+B')(); await pause();
      assert.equal(win.getOpacity(), 1);
      await js('window.mc.setOverlayInteraction(false)');
      await openSettings(); await select('output-sizing', 'content'); await save();
      // Keep a very long history entry mounted; only the current answer may size the window.
      await js(`document.querySelectorAll('.turn-body')[0].textContent=${JSON.stringify(paragraph.repeat(100))};document.querySelectorAll('.turn-body')[1].textContent='当前回答应当完整显示。';`);
      await pause(800);
      assert.equal(await js(`document.querySelectorAll('.turn').length`), 2, 'history must not be deleted');
      assert.equal(await js(`getComputedStyle(document.querySelector('.turn')).display`), 'none');
      assert.equal(await js(`(()=>{const text=document.querySelectorAll('.turn-body')[1].getBoundingClientRect();const box=document.querySelector('.session').getBoundingClientRect();return text.top>=box.top && text.bottom<=box.bottom})()`), true, 'the whole current answer must be visible');
      const short = win.getBounds();
      assert(Math.abs(short.width - bounds.width) <= 2, 'preserve width within native DIP rounding');
      assert(short.height < 560, 'short output should shrink height');
      fs.writeFileSync(path.join(profile, 'short-output.png'), (await win.webContents.capturePage()).toPNG());
      await js(`document.querySelectorAll('.turn-body')[1].textContent=${JSON.stringify(paragraph.repeat(160))}`);
      await pause(900);
      const long = win.getBounds();
      console.log('AUTO_BOUNDS', { short, long }, await js(`({cls:document.querySelector('.app').className,text:document.querySelector('.turn-body').textContent.length,session:document.querySelector('.session').getBoundingClientRect().height,turn:document.querySelector('.turn').getBoundingClientRect().height})`));
      console.log('BOUNDS_CALLS', boundsCalls.length, boundsCalls.slice(-5), 'FIXED', bounds);
      assert.equal(long.width, short.width, 'streamed output must not accumulate width changes');
      assert(long.height > short.height);
      const stableCalls = boundsCalls.length;
      await pause(400);
      assert.equal(boundsCalls.length, stableCalls, 'native DPI rounding must not cause repeated resizing');
      const work = screen.getDisplayMatching(long).workArea;
      assert(long.height <= work.height && long.y >= work.y);
      assert.equal(await js(`document.querySelector('.session').scrollHeight > document.querySelector('.session').clientHeight`), true);
      await openSettings();
      assert.equal(ignored, false, 'settings must remain interactive');
      fs.writeFileSync(path.join(profile, 'settings.png'), (await win.webContents.capturePage()).toPNG());
      await select('text-only', 'standard'); await save();
      assert.notEqual(await js(`getComputedStyle(document.querySelector('.turn')).display`), 'none', 'history returns when exiting fit mode');
      assert.equal(ignored, false);
      assert(win.getBounds().width >= 420, 'standard mode restores its own usable width');
      assert(Math.abs(win.getBounds().height - bounds.height) <= 3);
      await openSettings(); await select('text-only', 'standard'); await save();
      assert.equal(ignored, false, 'standard mode restores native interaction');
      assert(win.getBounds().width >= 420, 'standard mode retains its own minimum width');
      await openSettings(); await select('text-only', 'text'); await save();
      assert(Math.abs(win.getBounds().width - 300) <= 3, 'text-only mode restores its narrow width');
      const edgeWork = screen.getDisplayMatching(win.getBounds()).workArea;
      win.setPosition(edgeWork.x + edgeWork.width - win.getBounds().width, win.getBounds().y);
      await openSettings(); await select('text-only', 'standard'); await save();
      await openSettings(); await select('text-only', 'text'); await save();
      const edge = win.getBounds();
      assert(edge.x >= edgeWork.x && edge.x + edge.width <= edgeWork.x + edgeWork.width + 3,
        'mode switching keeps a narrow window on screen at the right edge');
      assert(Math.abs(edge.width - 300) <= 3, 'right-edge mode switch keeps the narrow width');
      assert.deepEqual(protection, [true], 'display operations must never disable content protection');
      assert.equal(await js('window.mc.getSettings().then(s=>s.ui.stealth)'), true);
      console.log('FLOATING_OUTPUT_SMOKE_OK', profile);
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require(path.resolve(__dirname, '../out/main/index.js'));

