import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {PracticeJournal,analyticsCode} from '../lib/practice-journal.mjs';
import {createApp} from '../server.mjs';
const secret='fixture-journal-secret-12345678901234567890';
const fixture=(id,overrides={})=>({id,owner:'owner-a',employee:{fullName:'Участников Тест',email:'never@example.invalid'},createdAt:Date.now(),mode:'ai',steps:[{}],history:[{text:'never store this transcript'}],context:{scenario:{id:'TM01',title:'Тестовое упражнение',topic:'Управление временем'},profile:{id:'ROLE_026',title:'Менеджер по продажам'}},report:{total:1.5,summary:'Разбор',growth:'Практика',scores:[{id:'C1',name:'Навык',score:1.5,target:2,quote:'never store this quote'}]},...overrides});
test('Рейтинг: только завершенные ИИ-упражнения, уникальные сценарии, дни, первые 10 и свое место',()=>{
  let now=Date.now();const j=new PracticeJournal({secret,now:()=>now});const you=j.person({fullName:'Участников Тест'},'owner-a');
  j.capture(fixture('one'));now+=86400000;j.capture(fixture('repeat'));j.capture(fixture('demo',{mode:'demo',employee:{fullName:'Демо Участник'}}));j.capture(fixture('open',{report:null,employee:{fullName:'Незавершивший Участник'}}));
  let board=j.leaderboard(you,{period:'30'});assert.equal(board.items.length,1);assert.equal(board.you.completed,1);assert.equal(board.you.days,2);assert.equal(board.you.average,1.5);
  for(let i=0;i<11;i++)for(let c=0;c<2;c++)j.capture(fixture(`${i}-${c}`,{employee:{fullName:`Синтетический${i} Участник`},context:{scenario:{id:`TEST${c}`,title:'Тест',topic:'SMART'},profile:{id:'ROLE_026',title:'Тест'}}}));
  board=j.leaderboard(you,{period:'all'});assert.equal(board.items.length,10);assert.equal(board.you.place,12);assert.equal(board.totalParticipants,12);assert(!JSON.stringify(board).includes(you.id));
  assert.equal(j.leaderboard(you,{topic:'Управление временем'}).items.length,1);
});
test('История изолирована, не содержит email, ключи, цитаты и переписку; сохраняется при выходе',()=>{
  const j=new PracticeJournal({secret}),s=fixture('one');j.capture(s);const person=j.person(s.employee,s.owner),stranger=j.person({fullName:'Другой Участник'},'owner-b');
  assert.equal(j.history(person).items.length,1);assert.equal(j.history(stranger).items.length,0);j.logout('owner-a');assert.equal(j.history(j.person(s.employee,'rotated-owner')).items.length,1);
  const stored=JSON.stringify(j.history(person));for(const value of ['never@example.invalid','never store this transcript','never store this quote',secret])assert(!stored.includes(value));
  assert.equal(new PracticeJournal({secret}).history(person).items.length,0);assert.equal(j.storage().persistent,false);
});
test('Отзывы: серверная проверка, один отзыв на упражнение, лимит правок, безопасные данные',()=>{
  let now=Date.now();const j=new PracticeJournal({secret,now:()=>now}),person=j.person({fullName:'Участников Тест'},'owner');const s=fixture('one').context.scenario,input={rating:5,category:'Предложение',text:'<img src=x onerror=alert(1)>'};
  assert.throws(()=>j.feedback(person,s,{...input,rating:6}));assert.throws(()=>j.feedback(person,s,{...input,text:'x'.repeat(2001)}));assert.throws(()=>j.feedback(person,s,{...input,category:'unknown'}));
  j.feedback(person,s,input);assert.equal(j.ownFeedback(person,s.id).review.text,input.text);assert.equal(j.ownFeedback(j.person(null,'other'),s.id).review,null);assert.throws(()=>j.feedback(person,s,input),e=>e.status===429);
  now+=10001;j.feedback(person,s,{...input,rating:4});const a=j.analytics({period:'all'});assert.equal(a.totals.reviewCount,1);assert.equal(a.totals.usefulness,4);assert.equal(a.scenarios[0].started,0);assert.equal(a.scenarios[0].usefulness,4);
});
test('Администратор: отдельный код, ограничение попыток, срок и выход',()=>{
  let now=Date.now();const j=new PracticeJournal({secret,now:()=>now});assert(!j.authorized('owner'));assert.throws(()=>j.loginAdmin('owner','wrong'),e=>e.status===403);assert(!j.authorized('owner'));
  j.loginAdmin('owner',analyticsCode(secret));assert(j.authorized('owner'));assert(!j.authorized('other'));now+=8*3600000+1;assert(!j.authorized('owner'));j.loginAdmin('owner',analyticsCode(secret));j.logout('owner');assert(!j.authorized('owner'));
  for(let i=0;i<19;i++)try{j.loginAdmin('owner','wrong');}catch{}assert.throws(()=>j.loginAdmin('owner','wrong'),e=>e.status===429);
});
function request(url,options={}){return new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(options.body);});}
test('HTTP: админка закрыта сотруднику, история своя, CSRF, отзывы и учет полного демо-пути',async t=>{
  const app=await createApp({hosted:false,accessRequired:true,codeVerification:false,employeeAllowlist:[{fullName:'Участников Тест',profileId:'ROLE_026'},{fullName:'Другой Участник',profileId:'ROLE_026'}],bridgeSettings:{token:secret},connection:{key:''}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function call(path,data){const r=await request(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,...(data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf})},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json();if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(value.csrf)csrf=value.csrf;return {r,value};}
  await call('auth/status');for(const path of ['history','leaderboard','analytics','feedback?scenario=TM01'])assert.equal((await call(path)).r.status,401);
  await call('auth/login',{fullName:'Участников Тест'});const boot=await call('bootstrap');assert(!JSON.stringify(boot.value).includes(analyticsCode(secret)));assert.equal((await call('analytics')).r.status,403);
  assert.equal((await call('admin/login',{code:'wrong'})).r.status,403);assert.equal((await call('admin/login',{code:analyticsCode(secret)})).r.status,200);
  let {value:s}=await call('sessions',{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'demo'});assert.equal((await call('history')).value.items.length,1);
  s=(await call(`sessions/${s.id}/turn`,{message:'К какому сроку нужна задача?',requestId:'test-1'})).value;
  await call(`sessions/${s.id}/finalize`,{});await call(`sessions/${s.id}/plan`,{answers:['','']});
  const record=(await call('history')).value.items[0];assert(record.reportAt);assert(record.planAt);assert.equal(record.turns,1);assert.equal(record.plan.weeks.length,4);assert.equal((await call('leaderboard')).value.items.length,0);
  assert.equal((await call('feedback',{scenarioId:'TM01',rating:4,category:'Впечатление',text:'Тест'})).r.status,200);
  const analytics=(await call('analytics')).value;assert.equal(analytics.totals.started,1);assert.equal(analytics.totals.planned,1);assert.equal(analytics.reviews.length,1);
  const savedCsrf=csrf;csrf='wrong';assert.equal((await call('feedback',{scenarioId:'TM01',rating:5,category:'Впечатление',text:'Тест'})).r.status,403);csrf=savedCsrf;
  await call('auth/logout',{});await call('auth/status');await call('auth/login',{fullName:'Другой Участник'});assert.equal((await call('history')).value.items.length,0);assert.equal((await call('analytics')).r.status,403);
  await call('auth/logout',{});await call('auth/status');await call('auth/login',{fullName:'Участников Тест'});assert.equal((await call('history')).value.items.length,1);assert.equal((await call('analytics')).r.status,403);
});
