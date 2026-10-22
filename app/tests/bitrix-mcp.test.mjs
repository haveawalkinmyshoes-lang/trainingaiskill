import test from 'node:test';
import assert from 'node:assert/strict';
import {BitrixMcp,createBitrixLoginSender} from '../lib/bitrix-mcp.mjs';
function fixture(users){
  const calls=[];
  const client=new BitrixMcp({url:'https://mcp.example.test/mcp',token:'FAKE-SECRET',fetcher:async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer FAKE-SECRET');assert.equal(options.redirect,'error');
    const input=JSON.parse(options.body);calls.push(input);let result;
    if(input.method==='initialize')result={protocolVersion:'2024-11-05'};
    if(input.method==='notifications/initialized')return new Response(null,{status:202});
    if(input.method==='tools/list')result={tools:[{name:'b24_call'}]};
    if(input.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({result:input.params.arguments.method==='user.get'?users:123})}]};
    return Response.json({jsonrpc:'2.0',id:input.id,result});
  }});return {client,calls};
}
test('MCP отправляет код только найденному активному пользователю; метод выбирает сервер',async()=>{
  const {client,calls}=fixture([{ID:'12',EMAIL:'test@example.test',ACTIVE:true}]);await client.sendLoginCode({email:'test@example.test',code:'012345'});
  const message=calls.find(x=>x.params?.arguments?.method==='im.message.add');assert.equal(message.params.arguments.params.DIALOG_ID,'12');assert(message.params.arguments.params.MESSAGE.includes('012345'));
  await assert.rejects(client.call('crm.deal.delete',{id:1}),/не разрешен/);
});
test('Отсутствие, неоднозначность и отключение учетной записи не приводят к отправке',async()=>{
  for(const users of [[],[{ID:'12',EMAIL:'test@example.test',ACTIVE:false}],[{ID:'12',EMAIL:'test@example.test',ACTIVE:true},{ID:'13',EMAIL:'test@example.test',ACTIVE:true}],[{ID:'12',EMAIL:'other@example.test',ACTIVE:true}]]){
    const {client,calls}=fixture(users);await assert.rejects(client.sendLoginCode({email:'test@example.test',code:'012345'}),/однозначно/);assert(!calls.some(x=>x.params?.arguments?.method==='im.message.add'));
  }
});
test('Секрет не появляется в сообщении об ошибке подключения',async()=>{
  const client=new BitrixMcp({url:'https://mcp.example.test/mcp',token:'FAKE-SECRET',fetcher:async()=>new Response('FAKE-SECRET',{status:401})});await assert.rejects(client.connect(),e=>e.status===503&&!e.message.includes('FAKE-SECRET'));
});
test('Токен в поле URL не роняет запуск и не попадает в ошибку',async()=>{
  const secret='FAKE-SECRET-IN-URL';let sender;
  assert.doesNotThrow(()=>{sender=createBitrixLoginSender({url:secret,token:'FAKE-KEY'});});
  await assert.rejects(sender({email:'test@example.test',code:'012345'}),error=>error.status===503&&error.message.includes('BITRIX_MCP_URL')&&!String(error.stack).includes(secret)&&!JSON.stringify(error).includes(secret));
  assert.throws(()=>new BitrixMcp({url:secret,token:'FAKE-KEY'}),error=>!String(error.stack).includes(secret)&&!Object.hasOwn(error,'input'));
});
