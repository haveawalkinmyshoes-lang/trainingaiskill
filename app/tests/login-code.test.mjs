import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {LoginCodes} from '../lib/login-code.mjs';
import {createApp} from '../server.mjs';
const person={fullName:'Тестов Тест Тестович',email:'test@example.test'};
test('Одноразовый код: срок, привязка к браузеру, повторная отправка, лимит ошибок',async()=>{
  let now=1000000,mail;const codes=new LoginCodes(async data=>{mail=data;},{clock:()=>now});
  const response=await codes.request('a',person,'local');assert.match(mail.code,/^\d{6}$/);assert(!JSON.stringify(response).includes(mail.code));
  assert(!JSON.stringify(response).includes(person.email));assert(!codes.pending.get('a').code);
  assert.throws(()=>codes.verify('b',mail.code),/истек/);
  await assert.rejects(codes.request('a',person,'local'),/через минуту/);
  assert.deepEqual(codes.verify('a',mail.code),{fullName:person.fullName});assert.throws(()=>codes.verify('a',mail.code),/истек/);
  now+=60001;await codes.request('a',person,'local');now+=300000;assert.throws(()=>codes.verify('a',mail.code),/истек/);
  await codes.request('a',person,'local');for(let i=0;i<5;i++)assert.throws(()=>codes.verify('a','wrong'),/не подошел/);assert.throws(()=>codes.verify('a',mail.code),/истек/);
});
test('Повторная отправка аннулирует прошлый код; неизвестное имя получает одинаковый ответ без письма',async()=>{
  let now=0,sent=[];const codes=new LoginCodes(async mail=>sent.push(mail),{clock:()=>now});
  const known=await codes.request('a',person,'ip'),unknown=await codes.request('b',null,'ip');assert.deepEqual(known,unknown);assert.equal(sent.length,1);
  now+=60000;await codes.request('a',person,'ip');
  // Random codes can coincide; the old HMAC state must still be replaced.
  assert.equal(sent.length,2);assert.deepEqual(codes.verify('a',sent[1].code),{fullName:person.fullName});
});
test('API не впускает по одному ФИО; код только для почты из списка, после проверки cookie меняется',async t=>{
  let mail;const app=await createApp({accessRequired:true,employeeAllowlist:[person],codeVerification:true,sendCode:async data=>{mail=data;}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base='http://127.0.0.1:'+app.server.address().port;const first=await fetch(base+'/api/auth/status');let cookie=first.headers.get('set-cookie').split(';')[0],csrf=(await first.json()).csrf;
  const post=(route,data)=>fetch(base+'/api/'+route,{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)});
  const requested=await post('auth/login',{fullName:person.fullName,email:'attacker@example.test'});assert.equal(requested.status,200);assert((await requested.json()).verificationRequired);assert.equal(mail.email,person.email);
  assert.equal((await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await post('auth/verify',{code:'wrong'})).status,401);
  const verified=await post('auth/verify',{code:mail.code});assert.equal(verified.status,200);const value=await verified.json();assert.deepEqual(value.employee,{fullName:person.fullName});const next=verified.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,next);cookie=next;csrf=value.csrf;
  assert.equal((await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await post('auth/verify',{code:mail.code})).status,401);
});
