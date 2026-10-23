const failure=(message,status=503)=>Object.assign(new Error(message),{status});
export class BitrixMcp{
  constructor({url,token,fetcher=fetch}){
    let parsed;
    try{parsed=new URL(typeof url==='string'?url.trim():'');}catch{throw failure('Проверьте BITRIX_MCP_URL: укажите HTTPS-адрес MCP, а не токен.');}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw failure('Для MCP нужен HTTPS-адрес без параметров и пароля');
    this.url=parsed.href;this.token=typeof token==='string'?token.trim():'';this.fetcher=fetcher;this.id=0;this.session=null;this.ready=null;
  }
  async rpc(method,params,notification=false){
    const requestId=++this.id;
    let response;
    try{response=await this.fetcher(this.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(this.session?{'Mcp-Session-Id':this.session}:{}),...(this.version?{'MCP-Protocol-Version':this.version}:{})},body:JSON.stringify({jsonrpc:'2.0',method,...(params?{params}:{}),...(notification?{}:{id:requestId})})});}
    catch{throw failure('Не удалось связаться с Битрикс24. Попробуйте позже.');}
    if(!response.ok)throw failure(response.status===401?'Организатору нужно проверить ключ подключения Битрикс24.':'Битрикс24 временно недоступен. Повторите позже.');
    this.session=response.headers.get('mcp-session-id')||this.session;
    if(notification){await response.body?.cancel();return;}
    const reader=response.body.getReader(),decoder=new TextDecoder();let source='';
    try{while(true){const {value,done}=await reader.read();if(done)break;source+=decoder.decode(value,{stream:true});if(source.length>1000000)throw failure('Слишком большой ответ Битрикс24.');
      if(response.headers.get('content-type')?.includes('text/event-stream')){
        for(const block of source.split(/\r?\n\r?\n/).slice(0,-1)){
          const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(data){let item;try{item=JSON.parse(data);}catch{continue;}if(item.id===requestId){if(item.error)throw failure('Битрикс24 отклонил запрос. Обратитесь к организатору.');return item.result;}}
        }
      }
    }}finally{await reader.cancel().catch(()=>{});}
    let item;try{item=JSON.parse(source);}catch{throw failure('Некорректный ответ сервиса Битрикс24.');}
    if(item.error)throw failure('Битрикс24 отклонил запрос. Обратитесь к организатору.');return item.result;
  }
  async connect(){
    if(!this.ready)this.ready=(async()=>{const result=await this.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'neurotrainer',version:'1.0'}});this.version=result.protocolVersion;await this.rpc('notifications/initialized',undefined,true);const list=await this.rpc('tools/list',{});if(!list.tools?.some(t=>t.name==='b24_call'))throw failure('В MCP не найден метод b24_call.');})();
    try{await this.ready;}catch(error){this.ready=null;throw error;}
  }
  async call(method,params={}){
    if(!['user.get','user.current','im.message.add'].includes(method))throw failure('Метод не разрешен интеграцией.',403);
    await this.connect();const result=await this.rpc('tools/call',{name:'b24_call',arguments:{method,params}});
    if(result.isError)throw failure('Не удалось выполнить действие в Битрикс24. Проверьте права вебхука.');
    let data=result.structuredContent;
    if(!data){try{data=JSON.parse(result.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n'));}catch{throw failure('Сервис Битрикс24 вернул непонятный ответ.');}}
    if(data?.error)throw failure('Битрикс24 отклонил действие. Проверьте права вебхука.');
    return data;
  }
  async findEmployee(email){
    const data=await this.call('user.get',{FILTER:{EMAIL:email,ACTIVE:true}});
    const rows=Array.isArray(data)?data:data?.result;
    if(!Array.isArray(rows))throw failure('Не удалось прочитать список пользователей Битрикс24.');
    const matches=rows.filter(p=>typeof p.EMAIL==='string'&&p.EMAIL.trim().toLowerCase()===email.trim().toLowerCase()&&[true,'Y','1',1].includes(p.ACTIVE)&&/^\d+$/.test(String(p.ID)));
    if(matches.length!==1)throw failure('Не удалось однозначно найти активного сотрудника в Битрикс24. Обратитесь к организатору.');
    return matches[0];
  }
  async sendLoginCode({email,code}){
    const employee=await this.findEmployee(email);
    const result=await this.call('im.message.add',{DIALOG_ID:String(employee.ID),MESSAGE:`Нейротренер: код входа ${code}.\nКод действует 5 минут. Никому не сообщайте его. Если вы не запрашивали вход, проигнорируйте сообщение.`,URL_PREVIEW:'N'});
    const id=typeof result==='number'?result:result?.result;
    if(!/^\d+$/.test(String(id)))throw failure('Битрикс24 не подтвердил отправку сообщения.');
    return {position:typeof employee.WORK_POSITION==='string'?employee.WORK_POSITION.trim():''};
  }
}
export function createBitrixLoginSender({url=process.env.BITRIX_MCP_URL,token=process.env.MCP_AUTH_TOKEN,fetcher}={}){
  if(!url?.trim()||!token?.trim())return null;
  let client;
  try{client=new BitrixMcp({url,token,fetcher});}
  catch(error){return async()=>{throw failure(error.message);};}
  return input=>client.sendLoginCode(input);
}
