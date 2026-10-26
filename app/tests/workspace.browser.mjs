import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {analyticsCode} from '../lib/practice-journal.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/kadry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const secret='fixture-workspace-admin-key-1234567890';
const app=await createApp({hosted:false,accessRequired:true,codeVerification:false,employeeAllowlist:[{fullName:'Участников Тест',profileId:'ROLE_026'}],bridgeSettings:{token:secret},connection:{key:''}});
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('403'))errors.push(m.text());});
  const base='http://127.0.0.1:'+app.server.address().port;
  await mkdir('../.work/ui-workspace',{recursive:true});
  await page.goto(base+'/#/rating');await page.locator('#login-full-name').fill('Участников Тест');await page.locator('#login-submit').click();
  await page.locator('#leaderboard-view').waitFor({state:'visible'});await page.getByRole('heading',{name:'Пока нет завершенных тренировок с ИИ'}).waitFor();
  await page.locator('#nav-analytics').click();await page.locator('#analytics-code').waitFor();assert(await page.locator('.ws-stats').count()===0);
  await page.locator('#analytics-code').fill(analyticsCode(secret));await page.getByRole('button',{name:'Открыть аналитику'}).click();await page.locator('.ws-stats').waitFor();
  await page.locator('#new-training').click();await page.locator('[data-topic="Управление временем"]').click();await page.locator('[data-scenario="TM01"]').click();
  await page.locator('#exercise-feedback').click();await page.locator('#feedback-dialog select').first().selectOption('4');await page.locator('#feedback-text').fill('<img src=x onerror=alert(1)> Нужен пример.');await page.getByRole('button',{name:'Сохранить отзыв'}).click();await page.locator('#feedback-dialog').waitFor({state:'hidden'});
  await page.locator('#start-session').click();await page.locator('#message-input').fill('К какому сроку нужна выгрузка?');await page.locator('#send-message').click();await page.waitForFunction(()=>!document.querySelector('#message-input').disabled&&document.querySelectorAll('.score-card').length===1);
  await page.locator('#finish-session').click();await page.locator('#result-view').waitFor({state:'visible'});await page.locator('#make-plan').click();await page.locator('#monthly-section').waitFor({state:'visible'});
  await page.locator('#nav-history').click();await page.locator('#history-view .ws-link').waitFor();await page.locator('#history-view .ws-link').click();await page.locator('#history-record-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#history-record-dialog h4').count(),4);await page.locator('#history-record-dialog .ws-dialog-close').click();
  await page.screenshot({path:'../.work/ui-workspace/history.png',fullPage:true});
  await page.locator('#nav-leaderboard').click();await page.getByRole('heading',{name:'Пока нет завершенных тренировок с ИИ'}).waitFor();
  // Synthetic records exist in this isolated test process only.
  for(let i=0;i<12;i++){const s=app.trainer.start('synthetic'+i,{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'demo'},{key:''});const internal=app.trainer.get(s.id,'synthetic'+i);internal.mode='ai';internal.employee={fullName:i===0?'Участников Тест':`Тестовый${i} Участник`};internal.report={total:1.5,summary:'Синтетические данные теста',growth:'Тест',scores:[]};app.journal.capture(internal);}
  await page.locator('#leaderboard-view .ws-heading button').click();await page.locator('#leaderboard-view .ws-table tbody tr').first().waitFor();assert.equal(await page.locator('#leaderboard-view .ws-table tbody tr').count(),10);
  await page.screenshot({path:'../.work/ui-workspace/rating.png',fullPage:true});
  await page.locator('#nav-analytics').click();await page.locator('.ws-review').waitFor();assert.match(await page.locator('.ws-review p').textContent(),/<img src=x/);assert.equal(await page.locator('.ws-review img').count(),0);
  await page.screenshot({path:'../.work/ui-workspace/analytics.png',fullPage:true});
  await page.locator('#sidebar-toggle').click();assert(await page.locator('body').evaluate(n=>n.classList.contains('sidebar-collapsed')));assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'false');await page.waitForFunction(()=>Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-76)<1);await page.locator('#nav-history').hover();await page.locator('#sidebar-tooltip').waitFor({state:'visible'});assert.equal(await page.locator('#sidebar-tooltip').textContent(),'Моя история');await page.mouse.move(800,50);await page.screenshot({path:'../.work/ui-workspace/collapsed.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});for(const name of ['history','leaderboard','analytics']){await page.locator('#nav-'+name).click();await page.waitForTimeout(100);assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),name+' mobile overflow');}
  await page.screenshot({path:'../.work/ui-workspace/mobile.png',fullPage:true});
  await page.locator('#sidebar-toggle').click();assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');assert(await page.locator('#sidebar-backdrop').isVisible());assert(await page.locator('#nav-history .nav-label').isVisible());await page.locator('#nav-history').click();assert(await page.locator('#sidebar-backdrop').isHidden());await page.locator('#nav-analytics').click();await page.locator('.ws-stats').waitFor();
  await page.reload();await page.locator('.ws-stats').waitFor();assert.equal(new URL(page.url()).hash,'#/admin');
  await page.locator('#sign-out').click();await page.locator('#login-view').waitFor({state:'visible'});assert.equal(await page.locator('.ws-review').count(),0);await page.locator('#login-full-name').fill('Участников Тест');await page.locator('#login-submit').click();await page.locator('#analytics-code').waitFor();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',screenshots:5,consoleErrors:errors}));
}finally{await browser.close();app.server.closeAllConnections();app.server.close();}
