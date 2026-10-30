import {createRequire} from 'node:module';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/kadry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const app=await createApp({hosted:false,accessRequired:true,codeVerification:false,employeeAllowlist:[{fullName:'Проверочный Тест',profileId:'ROLE_026'}],bridgeSettings:{token:''},connection:{key:''},call:async()=>{throw Error('AI calls forbidden in auth UI test');}});
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const browser=await chromium.launch({headless:true,channel:'msedge'}),base='http://127.0.0.1:'+app.server.address().port,errors=[];
const folder='outputs/auth-navigation-2026-10-30';await mkdir(folder,{recursive:true});
try{
  for(const width of [360,390,540,768,960,961,1440]){
    const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    let release;const statusGate=new Promise(resolve=>release=resolve);let first=true;
    await page.route('**/api/auth/status',async route=>{if(first){first=false;await statusGate;}await route.continue();});
    async function noNavigation(){for(const selector of ['.sidebar','#sidebar-toggle','.sidebar-backdrop','.sidebar-tooltip','main'])assert(await page.locator(selector).isHidden(),width+' '+selector+' must be hidden before authentication');}
    await page.goto(base+'/#/rating',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.sidebar-collapsed'));await noNavigation();
    release();await page.locator('#login-view').waitFor({state:'visible'});await noNavigation();assert(await page.locator('[data-login-step="delivery"]').isHidden());assert(await page.locator('[data-login-step="code"]').isHidden());assert(await page.locator('[data-login-step="access"]').isVisible());assert.equal(await page.locator('#login-submit').textContent(),'Войти');
    assert(await page.locator('.login-card').evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),'Login card must fit viewport');
    if(width===390)await page.screenshot({path:folder+'/mobile-login.png',fullPage:true});
    await page.locator('#login-full-name').fill('Проверочный Тест');await page.locator('#login-submit').click();await page.locator('main').waitFor({state:'visible'});assert(await page.locator('.sidebar').isVisible());
    if(width<=960){await page.locator('#sidebar-toggle').click();assert(await page.locator('.sidebar-backdrop').isVisible());}
    await page.locator('#sign-out').click();await page.locator('#login-view').waitFor({state:'visible'});await noNavigation();
    await page.reload();await page.locator('#login-view').waitFor({state:'visible'});await noNavigation();await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({widths:7,states:['initial_auth_check','login','signed_in','signed_out','reload'],consoleErrors:errors,paidApiCalls:0}));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
