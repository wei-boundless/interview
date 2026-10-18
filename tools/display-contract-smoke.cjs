// UI/IPC regression check; isolated profile, no providers or physical key injection.
const {app,globalShortcut,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
app.setAppPath(path.resolve(__dirname,'..'));
const profile=fs.mkdtempSync(path.join(require('os').tmpdir(),'mc-display-contract-'));
process.env.MC_USERDATA=profile;
const long='这是选中的历史识图回答，应当保持显示而不是被最新回答覆盖。'.repeat(90);
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({version:2,onboarding:{schemaVersion:1,completed:true},ui:{textOnly:true,outputAutoSize:true,stealth:true,fadeEnabled:true},asr:{backend:'cloud'}}));
fs.writeFileSync(path.join(profile,'sessions.json'),JSON.stringify({currentId:'demo',sessions:[{id:'demo',name:'QA',createdAt:1,segments:[],turns:[
{id:'vision-a',kind:'vision',label:'历史任务 A',text:long,status:'done',visionRootImageId:'a'},
{id:'vision-b',kind:'vision',label:'历史任务 B',text:'历史任务 B 的回答',status:'done',visionRootImageId:'b'},
{id:'latest',kind:'free',label:'最新',text:'最新回答',status:'streaming'}]}]}));
const keys=new Map();globalShortcut.register=(k,cb)=>{keys.set(k,cb);return true;};globalShortcut.unregisterAll=()=>keys.clear();
const shotRequests=[];ipcMain.on('shot:ask',(_event,payload)=>shotRequests.push(payload));
const pause=(ms=200)=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>{console.error('DISPLAY_CONTRACT_TIMEOUT');app.emit('before-quit');app.exit(1);},25000);
app.on('browser-window-created',(_e,win)=>{
 const protectedStates=[],protect=win.setContentProtection.bind(win);
 win.setContentProtection=v=>{protectedStates.push(v);return protect(v);};
 win.webContents.once('did-finish-load',async()=>{
  const js=c=>win.webContents.executeJavaScript(c);
  const visible=()=>js(`Array.from(document.querySelectorAll('.turn')).filter(e=>getComputedStyle(e).display!=='none').map(e=>e.dataset.turnId)`);
  const open=async()=>{await js('window.__mcOpenSettings()');await pause();};
  const select=async(id,value)=>{await js(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(50);};
  const save=async()=>{await js(`Array.from(document.querySelectorAll('.settings button')).find(b=>b.textContent==='仅应用显示设置').click()`);await pause(400);};
  try{
   await pause(800);
   const before=await js('window.mc.getSettings()');
   assert.deepEqual(await visible(),['latest']);
   keys.get('Control+Alt+PageUp')();await pause();assert.deepEqual(await visible(),['vision-b']);
   assert.equal(await js(`getComputedStyle(document.querySelector('.turn-selected .turn-head')).display`),'flex',
     'selected question label remains visible in text-only mode');
   assert.equal(await js(`getComputedStyle(document.querySelector('.turn-selected .turn-head .btn')).display`),'none',
     'selection label must not reveal answer controls');
   keys.get('Control+Alt+PageUp')();await pause(500);assert.deepEqual(await visible(),['vision-a']);
   assert.equal(await js(`document.querySelectorAll('.turn').length`),3);
   win.webContents.send('shot:hotkey','full');await pause(300);
   assert.equal(shotRequests.length,1);
   assert.equal(shotRequests[0].followup?.rootImageId,'a','selected screenshot must correct the original task');
   assert.equal(await js(`document.querySelectorAll('.turn').length`),3,'correction must not create a new task');
   const selectedBounds=win.getBounds();
   await js(`document.querySelector('.session').scrollTop=110`);await pause();
   const scroll=await js(`document.querySelector('.session').scrollTop`);
   win.webContents.send('llm:event',{kind:'delta',requestId:'latest',text:' 新回答仍在生成'});await pause(300);
   assert.deepEqual(await visible(),['vision-a']);
   assert.equal(await js(`document.querySelector('.session').scrollTop`),scroll,'hidden output must not move reading position');
   assert.deepEqual(win.getBounds(),selectedBounds,'height follows selected output');
   await open();assert.equal(await js(`document.getElementById('reveal-hold-delay').value`),'0');
   await select('reveal-hold-delay','150');await save();
   assert.equal(await js('window.mc.getSettings().then(s=>s.ui.revealHoldDelayMs)'),150);
   await open();assert.equal(await js(`document.getElementById('reveal-hold-delay').value`),'150');
   fs.writeFileSync(path.join(profile,'settings.png'),(await win.webContents.capturePage()).toPNG());
   await select('reveal-hold-delay','0');await save();
   const invalid=await js(`window.mc.setSettings({ui:{revealHoldDelayMs:-1}}).then(()=>false,()=>true)`);assert.equal(invalid,true);
   assert.equal(await js('window.mc.getSettings().then(s=>s.ui.revealHoldDelayMs)'),0);
   await open();await select('text-only','standard');await save();assert.equal((await visible()).length,3);
   await open();await select('text-only','text');await save();assert.deepEqual(await visible(),['vision-a']);
   keys.get('Control+Alt+Home')();await pause(500);assert.deepEqual(await visible(),['latest']);
   assert(win.getBounds().height<selectedBounds.height,'clear selection restores sizing to latest');
   assert.equal(await js(`document.querySelectorAll('.display-toggles button').length`),3);
   assert.equal(await js(`document.querySelector('.display-menu')`),null,'screenshot selection remains on its existing shortcuts');
   assert.equal(await js(`(()=>{const group=document.querySelector('.display-toggles');return group.scrollWidth<=group.clientWidth})()`),true);
   keys.get('Control+Alt+PageUp')();await pause();assert.deepEqual(await visible(),['vision-b']);
   keys.get('Control+Alt+Home')();await pause();assert.deepEqual(await visible(),['latest']);
   await js(`Array.from(document.querySelectorAll('.display-toggles button')).find(b=>b.textContent==='隐藏左栏').click()`);await pause();
   assert.equal(await js(`document.querySelector('.app').classList.contains('hide-transcript')`),true);
   await js(`Array.from(document.querySelectorAll('.display-toggles button')).find(b=>b.textContent==='隐藏左栏').click()`);await pause();
   assert.equal(await js(`document.querySelector('.app').classList.contains('hide-transcript')`),false);
   const after=await js('window.mc.getSettings()');assert.deepEqual(after.asr,before.asr);assert.deepEqual(after.llm,before.llm);assert.equal(after.ui.stealth,true);assert.deepEqual(protectedStates,[true]);
   console.log('DISPLAY_CONTRACT_OK',profile);clearTimeout(timeout);app.quit();
  }catch(error){console.error(error);clearTimeout(timeout);app.emit('before-quit');app.exit(1);}
 });
});
require(path.resolve(__dirname,'../out/main/index.js'));
