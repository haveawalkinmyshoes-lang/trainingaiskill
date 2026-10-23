import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createApp} from '../server.mjs';

const token='a-unique-test-bridge-token-with-at-least-32-characters';
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'};
async function fixture(t,options={}){
  const app=await createApp({accessRequired:true,employeeAllowlist:[{fullName:'Тестовый Сотрудник',email:'private@example.test'}],connection:{key:'private-api-key'},
    bridgeSettings:{token,renderKey:'',serviceId:'',allowDeploy:false},...options});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);}));
  const base='http://127.0.0.1:'+app.server.address().port;
  const rpc=async(method,params={},extra={})=>{
    const response=await fetch(base+'/mcp',{method:'POST',headers:{...headers,...extra},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    return {response,data:await response.json()};
  };
  const tool=async(name,args={})=>{
    const r=await rpc('tools/call',{name,arguments:args});
    return {...r,value:r.data.result?.content?.[0]?.text?JSON.parse(r.data.result.content[0].text):null};
  };
  return {app,base,rpc,tool};
}
test('Мост закрыт без отдельного ключа, не заменяет вход сотрудников, проверяет Origin/Host',async t=>{
  const {base,rpc}=await fixture(t);
  for(const authorization of ['', 'Bearer wrong', 'Bearer private-api-key']){
    const {response,data}=await rpc('tools/list',{}, {Authorization:authorization});assert.equal(response.status,401);assert(!JSON.stringify(data).includes('trainer_status'));
  }
  assert.equal((await rpc('tools/list',{}, {Origin:'https://evil.example'})).response.status,403);
  const badHost=await new Promise((resolve,reject)=>{const req=http.request(base+'/mcp',{method:'POST',headers:{...headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}));});
  assert.equal(badHost,403);
  assert.equal((await fetch(base+'/api/bootstrap',{headers:{Authorization:'Bearer '+token}})).status,401);
  const disabled=await fixture(t,{bridgeSettings:{token:'',renderKey:'',serviceId:'',allowDeploy:false}});
  assert.equal((await disabled.rpc('tools/list')).response.status,503);
  assert.equal((await fetch(base+'/private/neurotrainer-bridge.env')).status,404);
});
test('MCP initialize/list/call/notifications работают; некорректные запросы отклоняются',async t=>{
  const {base,rpc}=await fixture(t);
  const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(initialized.data.result.protocolVersion,'2025-06-18');
  const list=await rpc('tools/list');assert.equal(list.data.result.tools.length,8);
  assert(!list.data.result.tools.some(t=>t.name==='trainer_render_deploy'));
  assert(list.data.result.tools.find(t=>t.name==='trainer_status').annotations.readOnlyHint);
  assert.equal((await rpc('tools/call',{name:'shell',arguments:{cmd:'env'}})).data.error.code,-32602);
  assert.equal((await rpc('tools/call',{name:'trainer_status',arguments:{secret:true}})).data.error.code,-32602);
  assert.equal((await rpc('tools/call',{name:'trainer_check_ai',arguments:{confirm:false}})).data.error.code,-32602);
  assert.equal((await rpc('tools/call',{name:'trainer_profiles',arguments:{offset:-1}})).data.error.code,-32602);
  assert.equal((await rpc('tools/list',{}, {Accept:'text/html'})).response.status,406);
  assert.equal((await rpc('tools/list',{}, {'MCP-Protocol-Version':'invalid'})).response.status,400);
  assert.equal((await fetch(base+'/mcp',{headers})).status,405);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})})).status,202);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:'invalid'})).status,400);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify([{jsonrpc:'2.0',id:1,method:'ping'}])})).status,400);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:'x'.repeat(49000)})).status,400);
});
test('Диагностика и статистика не раскрывают ключи, ФИО, email, реплики и cookie',async t=>{
  const {app,rpc,tool}=await fixture(t);
  app.trainer.sessions.set('private-session',{id:'private-session',owner:'private-cookie',createdAt:Date.now(),employee:{fullName:'Тестовый Сотрудник',email:'private@example.test'},history:[{text:'PRIVATE_DIALOGUE'}],mode:'ai',complete:false,steps:[]});
  const outputs=[];
  for(const name of ['trainer_status','trainer_statistics','trainer_recent_errors','trainer_profiles']){
    const result=await tool(name);assert(!result.data.result.isError);outputs.push(result.data);
  }
  const stats=await tool('trainer_statistics');assert.equal(stats.value.total,1);assert.equal(stats.value.active,1);
  const status=await tool('trainer_status');assert(status.value.ai.configured);
  const scenario=app.trainer.library.config.scenarios[0];
  const profile=app.trainer.library.config.job_profiles.find(p=>{try{return app.trainer.library.config.scenario_competency_map.some(m=>m.scenario_id===scenario.id&&m.competency_ids.some(id=>Object.hasOwn(p.targets,String(id))));}catch{return false;}});
  assert.equal((await rpc('tools/call',{name:'trainer_scenarios',arguments:{profileId:profile.id,topic:scenario.topic}})).response.status,200);
  const explained=await tool('trainer_explain_scenario',{profileId:profile.id,scenarioId:scenario.id});assert.equal(typeof explained.value.available,'boolean');
  for(const secret of ['private-api-key','private@example.test','Тестовый Сотрудник','PRIVATE_DIALOGUE','private-cookie','private-session',token])assert(!JSON.stringify(outputs).includes(secret),secret);
});
test('Проверка ИИ: явный confirm, лимит частоты, ошибки без утечки провайдера',async t=>{
  let count=0;const {rpc}=await fixture(t,{call:async()=>{count++;throw Error('PRIVATE_PROVIDER_SECRET');}});
  const first=await rpc('tools/call',{name:'trainer_check_ai',arguments:{confirm:true}});assert(first.data.result.isError);assert(!JSON.stringify(first.data).includes('PRIVATE_PROVIDER_SECRET'));assert.equal(count,1);
  const next=await rpc('tools/call',{name:'trainer_check_ai',arguments:{confirm:true}});assert(next.data.result.isError);assert.equal(count,1);
  const errors=await rpc('tools/call',{name:'trainer_recent_errors'});assert(JSON.stringify(errors.data).includes('502'));assert(!JSON.stringify(errors.data).includes('PRIVATE_PROVIDER_SECRET'));
});
test('Render: только фиксированный сервис, без произвольных URL, секретов и повторной публикации',async t=>{
  const requests=[];
  const {rpc,tool}=await fixture(t,{bridgeSettings:{token,renderKey:'PRIVATE_RENDER_KEY',serviceId:'srv-test123',allowDeploy:true},bridgeFetch:async(url,options)=>{
    requests.push({url,options});const deploy={id:'dep-test',status:options.method==='POST'?'queued':'live',commit:{id:'abcdef',message:'PRIVATE_COMMIT'},image:{registryCredential:'PRIVATE_REGISTRY'}};
    return new Response(JSON.stringify(options.method==='GET'?[{deploy}]:deploy));
  }});
  const list=await tool('trainer_render_deploys');assert.equal(list.value.deploys[0].status,'live');assert(!JSON.stringify(list.data).includes('PRIVATE_'));
  assert.equal((await rpc('tools/call',{name:'trainer_render_deploy',arguments:{confirm:true,serviceId:'other'}})).data.error.code,-32602);
  const deploy=await tool('trainer_render_deploy',{confirm:true});assert(deploy.value.accepted);assert.equal(deploy.value.deploy.status,'queued');
  const repeated=await rpc('tools/call',{name:'trainer_render_deploy',arguments:{confirm:true}});assert(repeated.data.result.isError);assert.equal(requests.length,2);
  assert(requests.every(r=>r.url.startsWith('https://api.render.com/v1/services/srv-test123/deploys')));
});
test('У моста ограничен поток запросов',async t=>{
  const {rpc}=await fixture(t);for(let i=0;i<120;i++)assert.equal((await rpc('ping')).response.status,200);
  assert.equal((await rpc('ping')).response.status,429);
});
