import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {codeException} from '../lib/code-exceptions.mjs';
test('Обычный пользователь не становится исключением по клиентскому флагу',()=>{
  assert.equal(codeException({fullName:'Тестов Тест',email:'test@example.test',skipCode:true}),false);
  assert.equal(codeException(null),false);
});
test('Серверное исключение входит без сообщения; остальные сотрудники продолжают получать код',async t=>{
  let sent=0;
  const app=await createApp({accessRequired:true,codeVerification:true,employeeAllowlist:[{fullName:'Тестов Тест',email:'one@example.test'},{fullName:'Другой Тест',email:'two@example.test'}],codeBypass:person=>person.email==='one@example.test',lookupEmployee:async email=>{assert.equal(email,'one@example.test');return {id:'1546',position:'Менеджер по персоналу'};},sendCode:async()=>{sent++;},connection:{key:''}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const origin='http://127.0.0.1:'+app.server.address().port;
  async function login(fullName){const first=await fetch(origin+'/api/auth/status'),cookie=first.headers.get('set-cookie').split(';')[0],csrf=(await first.json()).csrf;return fetch(origin+'/api/auth/login',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({fullName,skipCode:true,bitrixId:'1546'})});}
  const own=await login('Тест Тестов');assert.equal(own.status,200);const value=await own.json();assert.equal(value.employee.fullName,'Тестов Тест');assert.equal(value.employee.position,'Менеджер по персоналу');assert.equal(value.verificationRequired,undefined);assert.equal(sent,0);
  const other=await login('Другой Тест');assert.equal(other.status,200);assert.equal((await other.json()).verificationRequired,true);assert.equal(sent,1);
});
