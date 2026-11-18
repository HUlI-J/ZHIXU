import {chromium, _electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve(import.meta.dirname,'..');
const output=resolve(process.env.ZHIXU_UI_EVIDENCE||join(root,'design-review/ui-audit'));
mkdirSync(output,{recursive:true});
const desktop=process.env.ZHIXU_UI_DESKTOP==='1';
const {ELECTRON_RUN_AS_NODE,...env}=process.env;
const app=desktop?await _electron.launch({executablePath:process.env.ZHIXU_TEST_EXE||join(root,'node_modules/electron/dist/electron.exe'),args:process.env.ZHIXU_TEST_EXE?[]:[join(root,'out/main/index.js')],cwd:root,env:{...env,ZHIXU_DATA_DIR:mkdtempSync(join(output,'isolated-data-'))}}):null;
const browser=app?null:await chromium.launch({channel:process.env.ZHIXU_UI_CHANNEL||'msedge',headless:true});
const page=app?await app.firstWindow():await browser.newPage();
const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
// Finish finite transitions deterministically, including background Electron windows.
const settle=()=>page.evaluate(()=>{for(const a of document.getAnimations())if(a.effect?.getComputedTiming().iterations!==Infinity)try{a.finish();}catch{}});
async function check(label){
 await settle();
 const metrics=await page.evaluate(()=>{
  const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
  const texts=Array.from(document.querySelectorAll('#view *,#modal-root *, .sidebar *, .topbar *')).filter(e=>visible(e)&&Array.from(e.childNodes).some(n=>n.nodeType===3&&n.textContent.trim()));
  return {overflow:document.documentElement.scrollWidth-innerWidth,small:texts.filter(e=>parseFloat(getComputedStyle(e).fontSize)<11).map(e=>e.className),serif:texts.filter(e=>/Georgia|Songti|STSong/.test(getComputedStyle(e).fontFamily)).map(e=>e.className),brokenImages:Array.from(document.images).filter(e=>!e.complete||!e.naturalWidth).map(e=>e.src)};
 });
 if(metrics.overflow>1){console.log(label,await page.evaluate(()=>Array.from(document.querySelectorAll('#view *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({cls:e.className,width:e.getBoundingClientRect().width,text:e.textContent.slice(0,30)})).slice(0,20)));await page.screenshot({path:join(output,'failure.png')});}
 assert.ok(metrics.overflow<=1,label+': overflow '+metrics.overflow);assert.deepEqual(metrics.small,[],label+': tiny text');assert.deepEqual(metrics.serif,[],label+': serif fallback');assert.deepEqual(metrics.brokenImages,[],label+': missing asset');
 results.push({label,...metrics});
}
async function render(view,extra={}){await page.evaluate(({view,extra})=>{Object.assign(state,{view},extra);render();},{view,extra});}
try{
 if(!app)await page.goto(process.env.ZHIXU_BROWSER_URL||pathToFileURL(join(root,'prototype/index.html')).href);
 await page.waitForFunction(()=>typeof workbenchReady!=='undefined'&&workbenchReady);
 const decline=page.locator('[data-action="builtin-consent-decline"]');if(await decline.count())await decline.click();
 for(const width of [1440,1000,768,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:960});await page.evaluate(theme=>{state.theme=theme;},theme);
  for(const view of ['today','chat','inbox','projects','reports','profile','data']){await render(view);await check(`${view}/${width}/${theme}`);if(width===1440||width===390)await page.screenshot({path:join(output,`${view}-${width}-${theme}.png`),animations:'disabled'});}
  for(const report of ['daily','weekly','monthly','project','risk','requirements']){
   await render('reports',{report});await check(`report-${report}/${width}/${theme}`);
   const geometry=await page.evaluate(()=>{const l=document.querySelector('.template-list').getBoundingClientRect(),s=document.querySelector('.report-sheet').getBoundingClientRect();return {list:l.top,sheet:s.top,weights:Array.from(document.querySelectorAll('.template-item,.report-sheet h1')).map(e=>Number(getComputedStyle(e).fontWeight))};});
   if(width>920)assert.ok(Math.abs(geometry.list-geometry.sheet)<1,JSON.stringify(geometry));assert.ok(geometry.weights.every(w=>w>=600));
  }
  for(const dataTab of ['plugins','workflow','storage']){await render('data',{dataTab});await check(`data-${dataTab}/${width}/${theme}`);}
  await render('projects');await page.locator('.project-card').first().click();
  for(const tab of await page.locator('.detail-tab').evaluateAll(els=>els.map(e=>e.dataset.tab))){await page.locator(`.detail-tab[data-tab="${tab}"]`).click();await check(`project-${tab}/${width}/${theme}`);}
  await render('today');
  await page.locator('[data-action="profile-settings"]').first().click();
  for(const tab of await page.locator('.settings-tabs [role="tab"]').evaluateAll(els=>els.map(e=>e.id))){await page.locator('#'+tab).click();await check(`settings-${tab}/${width}/${theme}`);}
  await page.locator('#modal-root [data-action="close-modal"]').first().click();
  await page.locator('[data-action="capture"]').first().click();await check(`capture/${width}/${theme}`);await page.locator('#modal-root [data-action="close-modal"]').first().click();
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{DB.projects[0].name='超长项目标题'.repeat(20)+'LongUnbrokenIdentifier'.repeat(12);DB.projects[0].goal='说明'.repeat(100);});
 for(const view of ['projects','reports']){await render(view,{report:'project'});await check(`long-text-${view}`);}
 await render('reports',{report:'daily'});await page.emulateMedia({media:'print'});await check('print-dark-report');
 assert.equal(await page.locator('.report-toolbar').isVisible(),false);
 assert.equal(await page.locator('.report-sheet').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 await page.emulateMedia({media:'screen'});await page.setViewportSize({width:1440,height:960});await render('reports',{report:'daily'});
 // Ask Chromium which installed font actually supplied the Chinese glyphs.
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root:documentNode}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:documentNode.nodeId,selector:'.page-head h1'});const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
 assert.ok(fonts.length>0);assert.deepEqual(errors,[]);
 writeFileSync(join(output,'result.json'),JSON.stringify({passed:true,runtime:desktop?'Electron':'browser',cases:results.length,fonts,errors,results},null,2));console.log(JSON.stringify({passed:true,cases:results.length,fonts}));
}finally{if(app)await app.close();else await browser.close();}
