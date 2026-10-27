import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/kadry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
let actorTurns=0,fixtureCalls=0;
const fakeCall=async(_,instruction,data,schema,name)=>{
  fixtureCalls++;const users=data.history?.filter(m=>m.role==='user')||[],quote=users.at(-1)?.text||'';
  if(name==='trainer_actor'){
    actorTurns++;const accepted=actorTurns>1;
    // Transport carries the current native user text; actor input intentionally has no raw history.
    return {reply:accepted?'Подтверждаю CSV по заказам за текущую неделю завтра до 11:00. Сегодня заканчивайте отчет.':'Нужен CSV из CRM: номер заказа, дата, сумма и статус за эту неделю. Работа займет 30 минут, встреча завтра в 12:00.',stageIds:[1],complete:accepted,conditions:data.scenario.trainingContract.requirements.map(c=>({id:c.id,state:'open',quote:''}))};
  }
  const scores=data.competencies.map(c=>({id:c.id,score:1,quote,reason:'Наблюдение тестового провайдера'}));
  const learning=data.scenario.learning_rubric.map((c,i)=>({id:c.id,score:name==='trainer_final'?2:i===0?1.5:null,quote:name==='trainer_final'||i===0?quote:'',reason:'Учебный критерий тестового провайдера',source:name==='trainer_final'||i===0?'independent':'unobserved'}));
  if(name==='trainer_grade')return {scores,learning};
  if(name==='trainer_final')return {scores,learning,summary:'Локальная проверка формы отчета без вызова модели.',strengths:[{text:'Назван рабочий срок',quote}],growth:'Проверить согласование результата',outcome:'achieved'};
  throw Error('Unexpected mock request '+name);
};
const app=await createApp({hosted:false,accessRequired:false,employeeAllowlist:[],bridgeSettings:{token:''},connection:{key:'offline-fixture'},call:fakeCall});
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const base='http://127.0.0.1:'+app.server.address().port,folder='outputs/scenario-revision-2026-10-27';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base)||url.startsWith('data:'))return route.continue();blocked.push(new URL(url).hostname);return route.abort();});
  await page.goto(base);await page.getByRole('button',{name:/Управление временем/}).click();await page.locator('[data-scenario="TM01"]').click();await page.locator('#start-session').click();
  await page.locator('#message-input').fill('Какой результат и реальный срок нужны для встречи?');await page.locator('#send-message').click();await page.waitForFunction(()=>!document.querySelector('#message-input').disabled&&document.querySelectorAll('.score-card').length===1);
  await page.locator('#message-input').fill('Сегодня завершу отчет к 16:00. Завтра с 10:00 до 10:30 сделаю CSV из CRM по текущей неделе: номер, дата, сумма, статус. Передам до 11:00, без персональных контактов. Подтвердите формат и срок.');await page.locator('#send-message').click();await page.waitForFunction(()=>!document.querySelector('#message-input').disabled&&document.querySelectorAll('.score-card').length===2);
  assert(await page.locator('#message-form').isVisible(),'Условия open не завершают диалог по complete=true');
  await page.locator('#finish-session').click();await page.locator('#result-view').waitFor({state:'visible'});
  assert.equal(await page.locator('#result-learning .competency-result').count(),5);assert.equal(await page.locator('#result-metric').textContent(),'Навык темы');assert.equal(await page.locator('#result-total').textContent(),'2');assert.equal(await page.locator('#outcome-label').textContent(),'Часть вопросов еще открыта');assert(await page.locator('#result-competencies .competency-result').count()>0);assert((await page.locator('#result-summary-text').textContent()).includes('Не все обязательные'));
  await page.screenshot({path:folder+'/result-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:folder+'/result-mobile.png',fullPage:true});const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert(width.scroll<=width.client,'Mobile horizontal overflow');assert.deepEqual(errors,[]);
  const result={ui:'passed',criteria:5,twoAssessmentLayers:true,earlyCompletionBlocked:true,fixtureCalls,paidApiCalls:0,blockedExternalHosts:[...new Set(blocked)],scriptErrors:errors};await writeFile(folder+'/browser-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
