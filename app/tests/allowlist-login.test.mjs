import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createCipheriv,randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {withStoredRoles,roleKey,roleEncryptionKey} from '../lib/stored-roles.mjs';
test('Вход по списку не отправляет код и не обращается к Битрикс даже при настроенном отправителе',async t=>{
  let external=0;const forbidden=async()=>{external++;throw Error('External lookup forbidden');};
  const app=await createApp({authMode:'allowlist',accessRequired:true,employeeAllowlist:[{fullName:'Тестов Антон',position:'Менеджер по продажам'},{fullName:'Отключенный Тест',enabled:false}],sendCode:forbidden,lookupEmployee:forbidden,bridgeSettings:{token:''},connection:{key:''}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.server.closeAllConnections();app.server.close();});const base='http://127.0.0.1:'+app.server.address().port;
  async function login(name){const r=await fetch(base+'/api/auth/status'),cookie=r.headers.get('set-cookie').split(';')[0],s=await r.json();assert.equal(s.codeVerification,false);return fetch(base+'/api/auth/login',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({fullName:name})});}
  assert.equal((await login('Неизвестный Тест')).status,401);assert.equal((await login('Отключенный Тест')).status,401);
  const r=await login('  Антон   ТЕСТОВ ');assert.equal(r.status,200);const s=await r.json();assert.equal(s.employee.fullName,'Тестов Антон');assert.equal(s.employee.position,'Менеджер по продажам');assert(!s.verificationRequired);assert.equal(external,0);
  const b=await fetch(base+'/api/bootstrap',{headers:{Cookie:r.headers.get('set-cookie').split(';')[0]}});assert.equal(b.status,200);assert.equal((await b.json()).employeeProfile.id,'ROLE_026');
  assert.equal((await fetch(base+'/data/employee-roles.enc.json')).status,404);
});
test('По умолчанию режим allowlist; восстановление кодов включается явно',async t=>{
  const a=await createApp({employeeAllowlist:[],bridgeSettings:{token:''},sendCode:async()=>{throw Error('Forbidden');}});a.server.listen(0,'127.0.0.1');await once(a.server,'listening');t.after(()=>{a.server.closeAllConnections();a.server.close();});const r=await fetch('http://127.0.0.1:'+a.server.address().port+'/api/auth/status');assert.equal((await r.json()).codeVerification,false);
});
test('Сохраненные должности расшифровываются только правильным ключом и не расширяют список допуска',async()=>{
  const secret='fixture-role-registry-secret-1234567890',iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',roleEncryptionKey(secret),iv),map={[roleKey(secret,'Тестов Антон')]:'Менеджер по продажам',[roleKey(secret,'Неизвестный Тест')]:'Директор'};
  const data=Buffer.concat([cipher.update(JSON.stringify(map),'utf8'),cipher.final()]),blob=JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
  const records=[{fullName:'Тестов Антон'}],readText=async()=>blob;
  assert.deepEqual(await withStoredRoles(records,secret,{readText}),[{fullName:'Тестов Антон',position:'Менеджер по продажам'}]);assert.deepEqual(await withStoredRoles(records,'wrong',{readText}),records);
  assert.deepEqual(await withStoredRoles([{fullName:'Тестов Антон',position:'Авторитетная должность из списка'}],secret,{readText}),[{fullName:'Тестов Антон',position:'Авторитетная должность из списка'}]);
  assert(!blob.includes('Тестов'));assert(!blob.includes('Менеджер'));
});
