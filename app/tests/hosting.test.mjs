import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import http from 'node:http';
function fetch(url,options={}){
  return new Promise((resolve,reject)=>{
    const req=http.request(url,options,res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});
    req.on('error',reject);req.end(options.body);
  });
}

test('Публичный сервер: healthcheck, HTTPS-cookie, закрытые настройки и изоляция сотрудников',async t=>{
  const previous=process.env.PUBLIC_URL;
  process.env.PUBLIC_URL='https://trainer.example';
  const {server}=await createApp({hosted:true,connection:{key:'fixture-secret'}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{if(previous===undefined)delete process.env.PUBLIC_URL;else process.env.PUBLIC_URL=previous;server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin+'/healthz')).status,200);
  assert.equal((await fetch(origin+'/api/bootstrap')).status,403);
  const r=await fetch(origin+'/api/bootstrap',{headers:{Host:'trainer.example'}});
  assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/; Secure/);
  const cookie=r.headers.get('set-cookie').split(';')[0],data=await r.json();
  assert(data.hosting.managed);assert(!JSON.stringify(data).includes('fixture-secret'));
  const headers={Host:'trainer.example',Cookie:cookie,Origin:'https://trainer.example','Content-Type':'application/json','X-CSRF-Token':data.csrf};
  const request=(path,payload)=>fetch(origin+'/api/'+path,{method:'POST',headers,body:JSON.stringify(payload)});
  assert.equal((await request('settings',{})).status,403);
  assert.equal((await request('connection',{})).status,403);
  const started=await request('sessions',{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'demo'});
  assert.equal(started.status,201);const session=await started.json();
  const stranger=await fetch(origin+'/api/sessions/'+session.id,{headers:{Host:'trainer.example'}});
  assert.equal(stranger.status,404);
  const foreign=await fetch(origin+'/api/bootstrap',{headers:{Host:'trainer.example',Origin:'https://foreign.example'}});
  assert.equal(foreign.status,403);
});
