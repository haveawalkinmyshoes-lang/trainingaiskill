import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {structuredCall,schemas,safeAIFailure} from '../lib/ai.mjs';
import {createApp} from '../server.mjs';
const connection={key:'TEST_SECRET',base:'https://example.test/v1',model:'test',style:'responses'};
const rejectProvider=(code,type='insufficient_quota')=>async()=>new Response(JSON.stringify({error:{code,type,message:'PRIVATE_PROVIDER_MESSAGE'}}),{status:429,headers:{'retry-after':'12'}});
test('API различает баланс, лимит проекта, квоту и скорость, не копируя ответ провайдера',async()=>{
  for(const [code,kind] of [['credit_balance_exhausted','balance'],['project_spend_limit_exceeded','spend_limit'],['organization_spend_limit_exceeded','spend_limit'],['organization_usage_limit_exceeded','usage_limit'],['insufficient_quota','quota'],['slow_down','rate_limit'],['rate_limit_exceeded','rate_limit']]){
    await assert.rejects(()=>structuredCall(connection,'',{},schemas.connection,'check',rejectProvider(code)),error=>{
      assert.equal(safeAIFailure(error).kind,kind);assert.equal(safeAIFailure(error).code,code);assert.equal(safeAIFailure(error).httpStatus,429);
      assert(!JSON.stringify(error).includes('PRIVATE_'));assert(!error.message.includes('PRIVATE_'));
      if(kind==='rate_limit')assert.match(error.message,/12 сек/);return true;
    });
  }
  await assert.rejects(()=>structuredCall(connection,'',{},schemas.connection,'check',rejectProvider('PRIVATE_UNKNOWN','PRIVATE_TYPE')),error=>{assert.equal(safeAIFailure(error).code,null);return true;});
  const forged=Object.assign(Error('PRIVATE'),{aiFailure:{kind:'PRIVATE',code:'PRIVATE',httpStatus:'PRIVATE',retryAfterSeconds:'PRIVATE'}});
  assert.deepEqual(safeAIFailure(forged),{kind:'unknown',code:null,httpStatus:null,retryAfterSeconds:null});
});
test('Мост показывает последнюю причину отказа API без нового платного вызова',async t=>{
  const token='bridge-test-unique-token-at-least-32-chars';let calls=0;
  const app=await createApp({accessRequired:true,employeeAllowlist:[],connection,bridgeSettings:{token,renderKey:'',serviceId:'',allowDeploy:false},
    call:async(...args)=>{calls++;return structuredCall(...args,rejectProvider('credit_balance_exhausted'));}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);}));
  async function tool(name,args={}){
    const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
    return (await r.json()).result;
  }
  const before=JSON.parse((await tool('trainer_status')).content[0].text);assert.equal(before.ai.lastFailure,null);assert.equal(calls,0);
  assert((await tool('trainer_check_ai',{confirm:true})).isError);assert.equal(calls,1);
  const status=JSON.parse((await tool('trainer_status')).content[0].text);
  assert.equal(status.ai.lastFailure.code,'credit_balance_exhausted');assert.equal(status.ai.lastSuccessAt,null);assert.equal(calls,1);
  assert(!JSON.stringify(status).includes('PRIVATE_'));assert(!JSON.stringify(status).includes('TEST_SECRET'));
});
