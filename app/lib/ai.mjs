const string = {type:'string'};
const score = {enum:[0,0.5,1,1.5,2,2.5,3,null]};
export const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array = items => ({type:'array',items});
const providerCodes=new Set(['credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','insufficient_quota','billing_hard_limit_reached','billing_not_active','rate_limit_exceeded','slow_down','rate_limit_error']);
function apiFailure(message,kind,httpStatus=null,code=null,retryAfterSeconds=null){
  return Object.assign(new Error(message),{aiFailure:{kind,httpStatus,code,retryAfterSeconds}});
}
export function safeAIFailure(error){
  const value=error?.aiFailure;
  const kinds=['balance','spend_limit','usage_limit','quota','rate_limit','authentication','access','request','not_found','provider','network','timeout','not_configured'];
  return {kind:kinds.includes(value?.kind)?value.kind:'unknown',httpStatus:Number.isInteger(value?.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599?value.httpStatus:null,
    code:providerCodes.has(value?.code)?value.code:null,retryAfterSeconds:Number.isInteger(value?.retryAfterSeconds)&&value.retryAfterSeconds>=0&&value.retryAfterSeconds<=86400?value.retryAfterSeconds:null};
}
export const scoreRow = (ids,quotes) => {
  const row=(scoreValues,quoteValues)=>object({id:{type:'integer',enum:ids},score:{enum:scoreValues},quote:{type:'string',enum:quoteValues},reason:string});
  return quotes?.length?{anyOf:[row([0.5,1,1.5,2,2.5,3],quotes),row([0,null],['',...quotes])]}:object({id:{type:'integer',enum:ids},score,quote:string,reason:string});
};
export const schemas = {
  actor:object({reply:string,stageIds:array({type:'integer',enum:[1,2,3,4,5]}),complete:{type:'boolean'}}),
  grade:(ids,quotes)=>object({scores:array(scoreRow(ids,quotes))}),
  final:(ids,quotes)=>object({scores:array(scoreRow(ids,quotes)),summary:string,strengths:array(object({text:string,quote:quotes?.length?{type:'string',enum:quotes}:string})),growth:string,outcome:{enum:['achieved','partial','not_achieved']}}),
  plan:ids=>object({focusIds:array({type:'integer',enum:ids}),goal:string,weeks:array(object({action:string,proof:string})),completion:string}),
  hint:object({text:string}),
  connection:object({ok:{type:'boolean'}})
};
export async function structuredCall(connection, instruction, data, schema, name, fetchImpl=fetch, transport={}) {
  if (!connection.key) throw apiFailure('Подключите ИИ в настройках: нужен API-ключ','not_configured');
  const format = {type:'json_schema',name,strict:true,schema};
  const conversation=transport.conversation||[];
  if(!Array.isArray(conversation)||conversation.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw new Error('Некорректные роли сообщений');
  const messages = [{role:'system',content:instruction},{role:'user',content:JSON.stringify(data)},...conversation];
  const chat = connection.style === 'chat';
  const body = chat ? {model:connection.model,messages,max_completion_tokens:3000,response_format:{type:'json_schema',json_schema:{name,strict:true,schema}}} :
    {model:connection.model,input:messages,store:false,max_output_tokens:3000,text:{format}};
  let response;
  try {
    response = await fetchImpl(connection.base.replace(/\/$/,'')+(chat?'/chat/completions':'/responses'), {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${connection.key}`},
      body:JSON.stringify(body),signal:AbortSignal.timeout(45000)
    });
  } catch (error) {
    if (error.name==='TimeoutError' || error.name==='AbortError') throw apiFailure('ИИ не ответил за 45 секунд. Повторите запрос; ход не сохранен.','timeout');
    throw apiFailure('Не удалось связаться с API. Проверьте адрес сервера и подключение.','network');
  }
  if (!response.ok) {
    if(response.status===429){
      let problem;try{problem=(await response.json())?.error;}catch{}
      const code=providerCodes.has(problem?.code)?problem.code:providerCodes.has(problem?.type)?problem.type:null;
      const rawRetry=response.headers?.get?.('retry-after');
      const retry=rawRetry&&/^\d+$/.test(rawRetry)&&Number(rawRetry)<=86400?Number(rawRetry):null;
      const descriptions={
        credit_balance_exhausted:['balance','На счете API закончились средства. Организатору нужно пополнить баланс API.'],
        organization_spend_limit_exceeded:['spend_limit','Достигнут лимит расходов организации API. Организатору нужно проверить лимиты расходов.'],
        project_spend_limit_exceeded:['spend_limit','Достигнут лимит расходов проекта API. Организатору нужно проверить лимит проекта.'],
        organization_usage_limit_exceeded:['usage_limit','Достигнут лимит использования организации API. Организатору нужно проверить доступную квоту.'],
        insufficient_quota:['quota','OpenAI: исчерпан баланс API или достигнут лимит расходов проекта. Организатору нужно проверить Billing и Limits.'],
        billing_hard_limit_reached:['spend_limit','Достигнут платежный лимит API. Организатору нужно проверить Billing и Limits.'],
        billing_not_active:['balance','Оплата API не активна. Организатору нужно проверить Billing.'],
        rate_limit_exceeded:['rate_limit','OpenAI: временно превышена скорость запросов.'],slow_down:['rate_limit','Скорость запросов к API выросла слишком быстро.'],rate_limit_error:['rate_limit','Временно превышена скорость запросов к API.']
      };
      if(code){const [kind,message]=descriptions[code];throw apiFailure(message+(kind==='rate_limit'?(retry!==null?' Повторите через '+retry+' сек.':' Подождите минуту и повторите.'):'')+' Ход не сохранен.',kind,429,code,retry);}
    }
    const map={401:'API не принял ключ. Проверьте его в настройках.',403:'Нет доступа к выбранной модели или API.',429:'API сообщил о лимите запросов или баланса. Повторите позже.',400:'API не принял запрос. Проверьте модель и поддержку JSON Schema.',404:'Не найдена модель или адрес API.'};
    throw apiFailure(map[response.status] || `Ошибка сервиса ИИ (${response.status}). Ход не сохранен.`,({401:'authentication',403:'access',400:'request',404:'not_found'})[response.status]||'provider',response.status);
  }
  const result=await response.json();
  let raw;
  if (chat) {
    const message=result.choices?.[0]?.message;
    if(message?.refusal) throw new Error('Модель отказалась продолжить этот запрос. Переформулируйте реплику.');
    if(result.choices?.[0]?.finish_reason==='length') throw new Error('Ответ модели обрезан. Попробуйте более короткую реплику.');
    raw=message?.content;
  } else {
    if(result.status && result.status!=='completed') throw new Error('Модель не завершила ответ. Повторите запрос.');
    const parts=(result.output||[]).flatMap(item=>item.content||[]);
    if(parts.some(p=>p.type==='refusal')) throw new Error('Модель отказалась продолжить этот запрос. Переформулируйте реплику.');
    raw=parts.filter(p=>p.type==='output_text').map(p=>p.text).join('');
  }
  try { return JSON.parse(raw); } catch { throw new Error('ИИ вернул ответ не по формату. Ход не сохранен; можно повторить.'); }
}
export function safeConnection(settings) {
  return {configured:Boolean(settings.key),base:settings.base,model:settings.model,style:settings.style};
}
