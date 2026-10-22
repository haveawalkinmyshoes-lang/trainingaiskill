import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';
import { loadLibrary } from '../lib/domain.mjs';
import { structuredCall,schemas } from '../lib/ai.mjs';
import http from 'node:http';
const library=await loadLibrary(fileURLToPath(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url)));
async function fixture(t,call){
  const app=await createApp({library,connection:{key:'',model:'fixture-model'},call});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);}));
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const initial=await fetch(origin+'/api/bootstrap'),cookie=initial.headers.get('set-cookie').split(';')[0],bootstrap=await initial.json();
  const request=async(path,data,extra={})=>{const r=await fetch(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':bootstrap.csrf}),...extra},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  return {origin,bootstrap,request,cookie,app};
}
test('Демо проходит весь путь: тема → должность → диалог → баллы → рефлексия → следующий месяц',async t=>{
  const f=await fixture(t);assert.equal(f.bootstrap.profiles.length,250);assert(!f.bootstrap.connection.configured);
  const cases=await f.request('scenarios?'+new URLSearchParams({topic:'Управление временем',profile:'ROLE_BRAND_SALES_01'}));assert(cases.data.scenarios.some(s=>s.id==='TM01'));
  const start=await f.request('sessions',{topic:'Управление временем',profileId:'ROLE_BRAND_SALES_01',scenarioId:'TM01',mode:'demo'});assert.equal(start.status,201);const id=start.data.id;
  const payload={message:'К какому сроку нужна выгрузка и для чего?',requestId:'one'};
  const turn=await f.request(`sessions/${id}/turn`,payload);assert.equal(turn.status,200);assert.equal(turn.data.steps.length,1);assert.equal(turn.data.steps[0].score,1.5);
  assert(!JSON.stringify(turn.data).includes('"hidden"'));
  const duplicate=await f.request(`sessions/${id}/turn`,payload);assert.equal(duplicate.data.steps.length,1);
  const conflict=await f.request(`sessions/${id}/turn`,{...payload,message:'Другая реплика'});assert.equal(conflict.status,409);
  const final=await f.request(`sessions/${id}/finalize`,{});assert.equal(final.status,200);assert(final.data.report.demo);assert(final.data.report.scores.every(s=>[37,38].includes(s.id)));
  const plan=await f.request(`sessions/${id}/plan`,{answers:['Уточнение срока','Обсуждение запросов коллег']});assert.equal(plan.status,200);assert.equal(plan.data.plan.weeks.length,4);assert.equal(plan.data.reflection[0],'Уточнение срока');assert(plan.data.plan.start>plan.data.date);
  const other=await fetch(f.origin+`/api/sessions/${id}`);assert.equal(other.status,404);
});
test('Без ключа ИИ не заменяется незаметно демо; закрытые файлы и чужой Origin недоступны',async t=>{
  const f=await fixture(t);
  const missing=await f.request('sessions',{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'ai'});assert.equal(missing.status,400);assert.match(missing.data.error,/ключ/);
  assert.equal((await f.request('settings',{base:'https://api.openai.com/v1',model:'m',style:'responses'},{Origin:'https://foreign.example'})).status,403);
  assert.equal((await f.request('settings',{base:'https://api.openai.com/v1',model:'m',style:'responses'},{'X-CSRF-Token':'wrong'})).status,403);
  for(const path of ['/.env','/server.mjs','/data/config.json','/../02_Инструкция_модели_Нейротренера.md'])assert.equal((await fetch(f.origin+path)).status,404);
});
test('ИИ-путь проверяет цитаты, не сохраняет неудачный ход и не раскрывает ключ',async t=>{
  let failGrade=true;
  const fakeCall=async(connection,instruction,input,schema,name)=>{
    if(name==='trainer_actor')return {reply:'Реально нужно завтра к полудню.',stageIds:[1],complete:false};
    if(name==='trainer_grade')return {scores:[{id:38,score:2,quote:failGrade?'выдуманный текст':input.history.at(-1).text,reason:'Уточнен срок'}]};
    if(name==='trainer_final')return {scores:input.competencies.map(c=>({id:c.id,score:c.id===38?2:null,quote:c.id===38?input.history.find(m=>m.role==='user').text:'',reason:'Наблюдение по диалогу'})),summary:'Срок уточнен.',strengths:[],growth:'Согласовать альтернативу',outcome:'partial'};
    if(name==='trainer_plan')return {focusIds:[38],goal:'Договариваться о следующем шаге',weeks:Array.from({length:4},()=>({action:'Применить прием',proof:'Запись разговора без персональных данных'})),completion:'Три случая из четырех'};
    return {ok:true};
  };
  const f=await fixture(t,fakeCall),secret='fixture-secret-do-not-expose';
  const settings=await f.request('settings',{key:secret,base:'https://api.openai.com/v1',model:'fixture-model',style:'responses'});assert(settings.data.configured);assert(!JSON.stringify(settings).includes(secret));
  const bootstrap=await f.request('bootstrap');assert(!JSON.stringify(bootstrap).includes(secret));
  const start=await f.request('sessions',{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'ai'}),id=start.data.id;
  const payload={message:'Какой реальный срок?',requestId:'live-one'};
  assert.equal((await f.request(`sessions/${id}/turn`,payload)).status,400);
  assert.equal((await f.request(`sessions/${id}`)).data.steps.length,0);
  failGrade=false;const ok=await f.request(`sessions/${id}/turn`,payload);assert.equal(ok.data.steps.length,1);assert.equal(ok.data.steps[0].score,2);assert(!JSON.stringify(ok).includes(secret));
  const done=await f.request(`sessions/${id}/finalize`,{});assert.equal(done.data.report.total,2);
  const plan=await f.request(`sessions/${id}/plan`,{answers:['','']});assert.equal(plan.data.plan.weeks.length,4);
});
test('Responses API использует JSON Schema, store=false и обрабатывает отказ без демо-подмены',async()=>{
  const connection={key:'fixture',base:'https://api.openai.com/v1',model:'fixture',style:'responses'};
  let request;
  const value=await structuredCall(connection,'instruction',{},schemas.connection,'test_connection',async(url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]})};});
  assert(value.ok);assert.equal(request.store,false);assert.equal(request.text.format.type,'json_schema');assert(request.text.format.strict);
  await assert.rejects(()=>structuredCall(connection,'',{},schemas.connection,'test',async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal',refusal:'declined'}]}]})})),/отказалась/);
  await assert.rejects(()=>structuredCall(connection,'',{},schemas.connection,'test',async()=>({ok:false,status:401})),/ключ/);
});
test('Полный ИИ-путь проходит через реальный HTTP-адаптер тестового провайдера',async t=>{
  const calls=[];
  const provider=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const request=JSON.parse(raw),input=JSON.parse(request.input[1].content),name=request.text.format.name;
    calls.push({name,path:req.url,store:request.store});
    assert.equal(req.headers.authorization,'Bearer local-fixture');
    let answer;
    if(name==='trainer_actor')answer={reply:'Мне нужно завтра к полудню для встречи.',stageIds:[1],complete:false};
    if(name==='trainer_grade')answer={scores:input.competencies.map(c=>({id:c.id,score:1.5,quote:input.history.at(-1).text,reason:'Уточнен рабочий срок'}))};
    if(name==='trainer_final')answer={scores:input.competencies.map(c=>({id:c.id,score:1.5,quote:input.history.find(m=>m.role==='user').text,reason:'Подтвержденное действие эпизода'})),summary:'Уточнен срок.',strengths:[],growth:'Согласовать следующий шаг',outcome:'partial'};
    if(name==='trainer_plan')answer={focusIds:[38],goal:'Согласовывать выполнимую альтернативу',weeks:Array.from({length:4},()=>({action:'Провести разговор о сроке',proof:'Краткая обезличенная запись'})),completion:'Три из четырех случаев'};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer)}]}]}));
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');t.after(()=>new Promise(resolve=>{provider.closeAllConnections();provider.close(resolve);}));
  const f=await fixture(t);
  await f.request('settings',{key:'local-fixture',base:`http://127.0.0.1:${provider.address().port}/v1`,model:'fixture',style:'responses'});
  const start=await f.request('sessions',{topic:'Управление временем',profileId:'ROLE_BRAND_SALES_01',scenarioId:'TM01',mode:'ai'}),id=start.data.id;
  const payload={message:'К какому сроку нужна выгрузка?',requestId:'http-fixture'};
  const turn=await f.request(`sessions/${id}/turn`,payload);assert.equal(turn.status,200);assert.equal(turn.data.mode,'ai');assert.equal(turn.data.steps[0].score,1.5);
  await f.request(`sessions/${id}/turn`,payload);assert.equal(calls.length,2,'Повтор хода не вызывает модель снова');
  const final=await f.request(`sessions/${id}/finalize`,{});assert.equal(final.data.report.total,1.5);
  const plan=await f.request(`sessions/${id}/plan`,{answers:['Уточнил срок','В разговоре с коллегой']});assert.equal(plan.data.plan.weeks.length,4);
  assert.deepEqual(calls.map(c=>c.name).sort(),['trainer_actor','trainer_final','trainer_grade','trainer_plan']);
  assert(calls.every(c=>c.path==='/v1/responses'&&c.store===false));
});
test('Пауза, продолжение и подсказка не получают баллов',async t=>{
  const f=await fixture(t),start=await f.request('sessions',{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'demo'}),id=start.data.id;
  const pause=await f.request(`sessions/${id}/turn`,{message:'Пауза',requestId:'pause'});assert(pause.data.paused);assert.equal(pause.data.steps.length,0);
  assert.equal((await f.request(`sessions/${id}/turn`,{message:'Реплика пока пауза',requestId:'blocked'})).status,400);
  const resume=await f.request(`sessions/${id}/turn`,{message:'Продолжить',requestId:'resume'});assert(!resume.data.paused);assert.equal(resume.data.steps.length,0);
  const hint=await f.request(`sessions/${id}/turn`,{message:'Подсказка',requestId:'hint'});assert.equal(hint.data.hintCount,1);assert.equal(hint.data.steps.length,0);
  const retried=await f.request(`sessions/${id}/turn`,{message:'Подсказка',requestId:'hint'});assert.equal(retried.data.hintCount,1);
});
test('Совместимый Chat Completions API получает соответствующий формат и обрабатывает обрезанный ответ',async()=>{
  const connection={key:'fixture',base:'https://example.test/v1',model:'fixture',style:'chat'};let requestPath,request;
  await structuredCall(connection,'rules',{},schemas.connection,'test',async(url,options)=>{requestPath=url;request=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]})};});
  assert.equal(requestPath,'https://example.test/v1/chat/completions');assert.equal(request.response_format.type,'json_schema');assert(request.response_format.json_schema.strict);
  await assert.rejects(()=>structuredCall(connection,'',{},schemas.connection,'test',async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})})),/обрезан/);
});
