import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {EmployeeAccess,normalizeFullName} from '../lib/access.mjs';
import {createApp} from '../server.mjs';
test('Сверка полного ФИО: пробелы, регистр, ё; нет поиска по части имени',()=>{
  const access=new EmployeeAccess(['Тестов Артём Тестович']);
  assert.equal(normalizeFullName(' ТЕСТОВ  Артём Тестович '),'тестов артем тестович');
  assert.equal(access.login('a','тестов артем тестович').fullName,'Тестов Артём Тестович');
  assert.throws(()=>access.login('a','Тестов'),/Доступ не найден/);
  assert.throws(()=>access.login('a','Чужой Артем Тестович'),/Доступ не найден/);
  const disabled=new EmployeeAccess([{fullName:'Тестов Артем Тестович',enabled:false}],{required:true});
  assert.throws(()=>disabled.login('a','Тестов Артем Тестович'),/не загружен/);
});
test('Допуск истекает и не зависит от запуска уборки сессий',()=>{
  const access=new EmployeeAccess(['Тестов Тест Тестович'],{ttlMs:100});
  access.grant('a',{fullName:'Тестов Тест Тестович'},1000);
  assert(access.current('a',1099));assert.equal(access.current('a',1100),null);
  for(let n=0;n<10;n++)assert.throws(()=>access.login('b','нет',2000),/Доступ не найден/);
  assert.throws(()=>access.login('b','Тестов Тест Тестович',2000),/Слишком много/);
});
test('Имя и фамилия в обоих порядках сохраняют ФИО и получателя из списка',()=>{
  const access=new EmployeeAccess([{fullName:'Тестов Артём',email:'test@example.test'}]);
  for(const name of ['Тестов Артём','Артём Тестов','  АРТЕМ   ТЕСТОВ '])assert.deepEqual(access.login(name,name),{fullName:'Тестов Артём',email:'test@example.test'});
  assert.throws(()=>access.login('x','Артём'),/Доступ не найден/);
  const full=new EmployeeAccess(['Тестов Артём Тестович']);
  for(const name of ['Артём Тестов Тестович','Артём Тестович Тестов'])assert.equal(full.login(name,name).fullName,'Тестов Артём Тестович');
  assert.throws(()=>full.login('x','Артём Тестов'),/Доступ не найден/);
});
test('Неоднозначные перестановки не выбирают получателя, отключенные записи не мешают',()=>{
  const records=[{fullName:'Тестов Артём',email:'first@example.test'},{fullName:'Артём Тестов',email:'second@example.test'}];
  const access=new EmployeeAccess(records);
  for(const name of ['Тестов Артём','Артём Тестов'])assert.throws(()=>access.login(name,name),e=>e.status===400&&e.message.includes('неоднозначно'));
  const active=new EmployeeAccess([records[0],{...records[1],enabled:false}]);assert.equal(active.login('x','Артём Тестов').email,'first@example.test');
});
test('Без входа закрыты каталог, сценарии, сессии и платный API; вход и выход меняют доступ',async t=>{
  let paidCalls=0;
  const app=await createApp({accessRequired:true,employeeAllowlist:['Тестов Тест Тестович'],connection:{key:'FAKE'},call:async()=>{paidCalls++;return {text:'Подсказка'};}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base='http://127.0.0.1:'+app.server.address().port;
  const first=await fetch(base+'/api/auth/status'),status=await first.json();
  let cookie=first.headers.get('set-cookie').split(';')[0],csrf=status.csrf;
  const request=(path,data,extra={})=>fetch(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,...(data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  assert(status.required);assert(status.configured);assert.equal(status.employee,null);
  assert(!JSON.stringify(status).includes('Тестов'));
  for(const path of ['bootstrap','scenarios?topic=SMART&profile=ROLE_026'])assert.equal((await request(path)).status,401);
  assert.equal((await request('sessions',{mode:'ai'})).status,401);
  assert.equal((await request('auth/login',{fullName:'Неизвестный Тест Тестович'})).status,401);
  assert.equal((await request('auth/login',{fullName:'Тестов Тест Тестович'},{'X-CSRF-Token':'wrong'})).status,403);
  const login=await request('auth/login',{fullName:'  ТЕСТОВ  ТЕСТ ТЕСТОВИЧ '});assert.equal(login.status,200);
  const oldCookie=cookie;cookie=login.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,oldCookie);csrf=(await login.json()).csrf;
  assert.equal((await request('bootstrap')).status,200);
  const session=await request('sessions',{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'ai'});assert.equal(session.status,201);const id=(await session.json()).id;
  assert.equal((await request('sessions/'+id+'/hint',{})).status,200);assert.equal(paidCalls,1);
  const logout=await request('auth/logout',{});assert.equal(logout.status,200);
  assert.equal((await request('sessions/'+id)).status,401);assert.equal(app.trainer.sessions.size,0);
});
test('Пустой обязательный список не открывает доступ',async t=>{
  const app=await createApp({accessRequired:true,employeeAllowlist:[]});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base='http://127.0.0.1:'+app.server.address().port;
  const status=await (await fetch(base+'/api/auth/status')).json();assert(status.required);assert(!status.configured);
  assert.equal((await fetch(base+'/api/bootstrap')).status,401);
});
