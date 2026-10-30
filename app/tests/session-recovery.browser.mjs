import {createRequire} from 'node:module';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/kadry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'}),apps=[];
const results=[],errors=[];
try{
  for(const required of [false,true]){
    const app=await createApp({accessRequired:required,employeeAllowlist:required?[{fullName:'Тестов Тест Тестович',profileId:'ROLE_026'}]:[],connection:{key:''}});apps.push(app);
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
    const context=await browser.newContext(),page=await context.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+app.server.address().port;
    await page.goto(origin);
    if(required){await page.locator('#login-full-name').fill('Тестов Тест Тестович');await page.locator('#login-submit').click();}
    async function start(){
      await page.getByRole('button',{name:'Постановка задач',exact:false}).click();
      await page.locator('[data-scenario="S03"]').click();await page.locator('#start-session').click();await page.locator('#chat-view').waitFor({state:'visible'});
    }
    await start();
    let turns=0;await page.route('**/api/sessions/*/turn',async route=>{
      turns++;if(turns===1)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Обновите страницу: истек токен запроса'})});return route.continue();
    });
    await page.locator('#message-input').fill('Какой результат нужен и к какому сроку?');await page.locator('#send-message').click();
    await page.locator('.score-card').waitFor({state:'attached'});await page.locator('#send-message').waitFor({state:'visible'});assert.equal(turns,2);assert.equal(await page.locator('.message-row.user').count(),1);
    let finalizations=0;await page.route('**/api/sessions/*/finalize',async route=>{
      finalizations++;if(finalizations===1)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Откройте приложение перед отправкой запроса'})});return route.continue();
    });
    await page.locator('#finish-session').click();await page.locator('#result-view').waitFor({state:'visible'});assert.equal(finalizations,2);
    await page.locator('#new-training').click();await start();await context.clearCookies();
    await page.locator('#finish-session').click();
    await page.locator(required?'#login-view':'#setup-view').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('nt-current-session')),null);
    assert.match(await page.locator('#toast').textContent(),required?/Войдите снова/:/Начните новую тренировку/);
    await page.screenshot({path:'outputs/session-recovery-2026-10-30/'+(required?'expired-login':'expired-conversation')+'.png',fullPage:true});
    if(required){await page.locator('#login-full-name').fill('Тестов Тест Тестович');await page.locator('#login-submit').click();}
    await page.locator('#login-view').waitFor({state:'hidden'});
    await page.locator('#new-training').click();
    await start();assert(await page.locator('#send-message').isEnabled());
    results.push({required,scenario:'S03',staleTokenTurn:'passed',staleCookieFinalize:'passed',lostSessionExit:'passed',newConversation:'passed'});
    await context.close();
  }
  assert.deepEqual(errors,[]);await writeFile('outputs/session-recovery-2026-10-30/browser-verification.json',JSON.stringify({results,errors,paidApiCalls:0},null,2));console.log(JSON.stringify(results));
}catch(error){for(const context of browser.contexts())for(const page of context.pages()){console.log((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:'outputs/session-recovery-2026-10-30/failure.png',fullPage:true});}throw error;
}finally{await browser.close();for(const app of apps){app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}}
