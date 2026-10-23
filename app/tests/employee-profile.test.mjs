import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {loadLibrary} from '../lib/domain.mjs';
import {resolveEmployeeProfile} from '../lib/employee-profile.mjs';
import {createApp} from '../server.mjs';
const {config}=await loadLibrary(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url));
test('Автоматический профиль различает точное название, синоним и общий профиль',()=>{
  assert.equal(resolveEmployeeProfile(config,{position:'Бренд-менеджер г. Ижевск'}).profile.family,'Продажи');
  assert.equal(resolveEmployeeProfile(config,{position:'Руководитель HR'}).profile.id,'ROLE_158');
  const generic=resolveEmployeeProfile(config,{position:'Руководитель отдела контроля качества'});assert.equal(generic.profile.id,'ROLE_232');assert.equal(generic.match,'general');
  assert.equal(resolveEmployeeProfile(config,{position:'Руководитель отдела контроля качества'},{allowRelated:false}),null);
  assert.equal(resolveEmployeeProfile(config,{position:'Совершенно неизвестная должность'}),null);
});
test('Должность из Битрикс24 сохраняется только после проверки кода; клиент не меняет профиль и сложность',async t=>{
  let code;
  const app=await createApp({accessRequired:true,codeVerification:true,employeeAllowlist:[{fullName:'Тестов Тест',email:'test@example.test'}],sendCode:async data=>{code=data.code;return {position:'Финансовый директор'};},connection:{key:''}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const origin='http://127.0.0.1:'+app.server.address().port;
  const first=await fetch(origin+'/api/auth/status');let cookie=first.headers.get('set-cookie').split(';')[0],csrf=(await first.json()).csrf;
  const request=(path,data)=>fetch(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf})},body:data===undefined?undefined:JSON.stringify(data)});
  await request('auth/login',{fullName:'Тест Тестов',profileId:'ROLE_001',position:'Генеральный директор'});
  assert.equal((await (await request('auth/status')).json()).employee,null);
  const verified=await request('auth/verify',{code,position:'Генеральный директор'});const value=await verified.json();assert.equal(value.employee.position,'Финансовый директор');cookie=verified.headers.get('set-cookie').split(';')[0];csrf=value.csrf;
  const catalog=await (await request('bootstrap')).json();assert.equal(catalog.employeeProfile.id,'ROLE_148');
  const scenarios=await (await request('scenarios?topic='+encodeURIComponent('Управление временем')+'&profile=ROLE_001')).json();assert(scenarios.scenarios.length>0);
  const started=await request('sessions',{topic:'Управление временем',scenarioId:scenarios.scenarios[0].id,profileId:'ROLE_001',difficulty:'сложный',mode:'demo'});const session=await started.json();assert.equal(started.status,201,session.error);assert.equal(session.profile.id,'ROLE_148');assert.equal(session.difficulty,'начальный');
});
