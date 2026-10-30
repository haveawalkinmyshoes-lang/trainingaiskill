import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../public/api.js';

const stale={error:'Откройте приложение перед отправкой запроса'};
function fixture(replies){
  const calls=[],expired=[];let csrf='old';
  const api=createApi({getCsrf:()=>csrf,setCsrf:value=>{csrf=value;},onExpired:value=>expired.push(value),fetchImpl:async(path,options)=>{
    calls.push({path,...options});assert(replies.length,'Unexpected request: '+path);
    const [status,value]=replies.shift();return new Response(JSON.stringify(value),{status});
  }});
  return {api,calls,expired};
}
for(const action of ['turn','finalize','hint','plan'])test(action+': refresh stale CSRF, verify conversation, retry rejected request once',async()=>{
  const f=fixture([[403,{error:'Обновите страницу: истек токен запроса'}],[200,{csrf:'fresh',required:true,employee:{fullName:'Тест'}}],[200,{id:'abc-123'}],[200,{ok:true}]]);
  const data={message:'Ответ',requestId:'unchanged'};
  assert.deepEqual(await f.api('sessions/abc-123/'+action,data),{ok:true});
  assert.deepEqual(f.calls.map(c=>c.path),['/api/sessions/abc-123/'+action,'/api/auth/status','/api/sessions/abc-123','/api/sessions/abc-123/'+action]);
  assert.equal(f.calls[3].body,f.calls[0].body);assert.equal(f.calls[3].headers['X-CSRF-Token'],'fresh');assert.deepEqual(f.expired,[]);
});
test('Lost owner requires login without resubmitting the AI request',async()=>{
  const f=fixture([[403,stale],[200,{csrf:'fresh',required:true,employee:null}]]);
  await assert.rejects(f.api('sessions/abc-123/finalize',{}),/Войдите снова/);
  assert.equal(f.calls.length,2);assert.equal(f.expired[0].login,true);
});
test('Lost conversation exits the blocked chat without submitting the AI request again',async()=>{
  const f=fixture([[403,stale],[200,{csrf:'fresh',required:false}],[404,{error:'Тренировка не найдена'}]]);
  await assert.rejects(f.api('sessions/abc-123/turn',{requestId:'one'}),/Начните новую тренировку/);
  assert.equal(f.calls.length,3);assert.equal(f.expired[0].login,false);
});
test('Expired access and missing conversation also recover on direct responses',async()=>{
  for(const status of [401,404]){
    const f=fixture([[status,{error:'expired'}]]);
    await assert.rejects(f.api('sessions/abc-123/finalize',{}));
    assert.equal(f.calls.length,1);assert.equal(f.expired[0].login,status===401);
  }
});
test('Auth recovery still works before login',async()=>{
  const f=fixture([[403,stale],[200,{csrf:'fresh',required:true,employee:null}],[200,{employee:{fullName:'Тест'}}]]);
  await f.api('auth/login',{fullName:'Тест'});assert.equal(f.calls.length,3);assert.deepEqual(f.expired,[]);
});
test('No automatic retry on AI failures, network failures, or unrelated forbidden responses',async()=>{
  for(const status of [400,403,429,502]){
    const f=fixture([[status,{error:'Failure'}]]);
    await assert.rejects(f.api('sessions/abc-123/finalize',{}),/Failure/);assert.equal(f.calls.length,1);
  }
  let calls=0;const api=createApi({getCsrf:()=>'',setCsrf:()=>{},onExpired:()=>{},fetchImpl:async()=>{calls++;throw new Error('Network');}});
  await assert.rejects(api('sessions/abc-123/turn',{}),/Network/);assert.equal(calls,1);
});
test('A second stale rejection stops instead of looping',async()=>{
  const f=fixture([[403,stale],[200,{csrf:'fresh',required:false}],[200,{id:'abc-123'}],[403,stale]]);
  await assert.rejects(f.api('sessions/abc-123/finalize',{}));assert.equal(f.calls.length,4);
});
