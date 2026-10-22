import {createRequire} from 'node:module';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/kadry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const app=await createApp({accessRequired:true,employeeAllowlist:['Тестов Тест Тестович'],connection:{key:''}});
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  await mkdir('../.work/ui',{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url='http://127.0.0.1:'+app.server.address().port;
  await page.goto(url);await page.locator('#login-view').waitFor({state:'visible'});
  assert(await page.locator('main').isHidden());
  await page.screenshot({path:'../.work/ui/10-access.png',fullPage:true});
  await page.locator('#login-full-name').fill('Неизвестный Тест Тестович');await page.locator('#login-submit').click();
  await page.waitForFunction(()=>document.querySelector('#login-message').textContent.includes('Доступ не найден'));
  await page.locator('#login-full-name').fill(' ТЕСТОВ  ТЕСТ ТЕСТОВИЧ ');await page.locator('#login-submit').click();
  await page.locator('#login-view').waitFor({state:'hidden'});assert(await page.locator('main').isVisible());
  assert.equal(await page.locator('#signed-in-name').textContent(),'Тестов Тест Тестович');
  await page.reload();await page.locator('#employee-account').waitFor({state:'visible'});
  await page.locator('#sign-out').click();await page.locator('#login-view').waitFor({state:'visible'});assert(await page.locator('main').isHidden());
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'../.work/ui/11-access-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('Access UI passed: denied name, allowed name, reload, logout, mobile.');
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
