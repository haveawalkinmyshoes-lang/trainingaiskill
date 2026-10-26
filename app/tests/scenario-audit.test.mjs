import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {loadLibrary} from '../lib/domain.mjs';
import {ScenarioAudit} from '../lib/scenario-audit.mjs';
import {createApp} from '../server.mjs';
const library=await loadLibrary(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url));
function fakeProvider(counter){return async(...args)=>{counter.count++;args[6].onUsage({input_tokens:1000,input_tokens_details:{cached_tokens:100,cache_write_tokens:0},output_tokens:100,output_tokens_details:{reasoning_tokens:30}});const data=args[2];if(args[4]==='trainer_actor')return {reply:'Уточним условия и согласуем следующий шаг.',stageIds:[1],complete:false};return {scores:data.competencies.map(c=>({id:c.id,score:null,quote:'',reason:'Недостаточно наблюдений'})),summary:'Тестовый итог',strengths:[],growth:'Уточнять результат',outcome:'partial'};};}
test('Аудит покрывает все 45 сценариев, выбирает допустимые профили и помещается в 200 запросов',()=>{
  const audit=new ScenarioAudit(library,{key:'fixture',model:'gpt-6.1-sol'},()=>{});assert.equal(audit.fixtures.length,45);assert.equal(new Set(audit.fixtures.map(f=>f.scenario.id)).size,45);assert(audit.status().plannedMaximumCalls<=200);assert(audit.fixtures.every(f=>f.fixture.messages.length>=3));assert.equal(audit.fixtures.find(f=>f.scenario.id==='S05').fixture.messages.length,7);
});
test('Аудит вызывает живой путь персонажа и финального оценщика, кэширует прогон и считает usage без фиктивных пошаговых баллов',async()=>{
  const counter={count:0},audit=new ScenarioAudit(library,{key:'fixture',model:'gpt-6.1-sol'},fakeProvider(counter));const output=await audit.run({action:'run',offset:0,limit:1});assert.equal(output.cases[0].status,'complete');assert.equal(output.cases[0].history.filter(m=>m.role==='user').length,3);assert.equal(counter.count,4);assert.equal(output.status.usage.input,4000);assert.equal(output.status.usage.output,400);assert.equal(output.status.unknownUsage,0);assert(output.status.costUSD>0);assert.equal(output.cases[0].report.outcome,'partial');assert.equal((await audit.run({action:'run',offset:0,limit:1})).cases[0].id,'S01');assert.equal(counter.count,4);
  await assert.rejects(()=>audit.run({action:'run',offset:45,limit:1}));
});
test('Защитный бюджет и лимит запросов останавливают только аудит; ошибка сохраняется честно',async()=>{
  const counter={count:0},audit=new ScenarioAudit(library,{key:'fixture',model:'gpt-6.1-sol'},fakeProvider(counter),{maxUSD:0});const output=await audit.run({action:'run',offset:0,limit:1});assert.equal(output.cases[0].status,'error');assert.match(output.cases[0].error,/бюджет/);assert.equal(counter.count,0);assert.equal(output.cases[0].report,null);
});

test('Один временный отказ API повторяется без потери диалога и без маскировки неизвестного usage',async()=>{
  const counter={count:0},base=fakeProvider(counter);let failed=false;const audit=new ScenarioAudit(library,{key:'fixture',model:'gpt-6.1-sol'},async(...args)=>{if(!failed){failed=true;counter.count++;throw Object.assign(new Error('Temporary failure'),{aiFailure:{kind:'provider',httpStatus:503}});}return base(...args);});const output=await audit.run({action:'run',offset:0,limit:1});assert.equal(output.cases[0].status,'complete');assert.equal(counter.count,5);assert.equal(output.status.unknownUsage,1);assert(output.cases[0].flags.includes('transient_api_retry'));
});

test('Повтор временного отказа ограничен тремя попытками и расходуется из общего бюджета',async()=>{
  let count=0;const audit=new ScenarioAudit(library,{key:'fixture',model:'gpt-6.1-sol'},async()=>{count++;throw Object.assign(new Error('Temporary failure'),{aiFailure:{kind:'provider',httpStatus:503}});});
  const output=await audit.run({action:'run',offset:0,limit:1});assert.equal(output.cases[0].status,'error');assert.equal(count,3);assert.equal(output.status.calls,3);assert.equal(output.status.unknownUsage,3);assert(output.status.costUSD>0);await audit.run({action:'run',offset:0,limit:1});assert.equal(count,3);
});
test('API аудита закрыт ключом моста, требует confirm, отвергает произвольные данные и не создает записи сотрудников',async t=>{
  const token='audit-private-fixture-token-12345678901234567890',counter={count:0};const app=await createApp({accessRequired:true,employeeAllowlist:[],bridgeSettings:{token},connection:{key:'fixture',model:'gpt-6.1-sol'},call:fakeProvider(counter)});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.server.closeAllConnections();app.server.close();});const base='http://127.0.0.1:'+app.server.address().port;
  const rpc=async(argumentsValue,auth=token)=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'trainer_audit_scenarios',arguments:argumentsValue}})});return {status:r.status,data:await r.json()};};
  assert.equal((await rpc({confirm:true,action:'status'},'wrong')).status,401);assert((await rpc({action:'run'})).data.error);assert((await rpc({confirm:true,action:'invalid'})).data.error);assert((await rpc({confirm:true,action:'run',prompt:'arbitrary'})).data.error);assert.equal(counter.count,0);
  const result=await rpc({confirm:true,action:'run',offset:0,limit:1});assert(!result.data.result.isError);assert.equal(counter.count,4);assert.equal(app.trainer.sessions.size,0);assert.equal(app.journal.records.size,0);
});
