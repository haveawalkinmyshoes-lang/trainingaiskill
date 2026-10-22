const string = {type:'string'};
const score = {enum:[0,0.5,1,1.5,2,2.5,3,null]};
export const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array = items => ({type:'array',items});
export const scoreRow = ids => object({id:{type:'integer',enum:ids},score,quote:string,reason:string});
export const schemas = {
  actor:object({reply:string,stageIds:array({type:'integer',enum:[1,2,3,4,5]}),complete:{type:'boolean'}}),
  grade:ids=>object({scores:array(scoreRow(ids))}),
  final:ids=>object({scores:array(scoreRow(ids)),summary:string,strengths:array(object({text:string,quote:string})),growth:string,outcome:{enum:['achieved','partial','not_achieved']}}),
  plan:ids=>object({focusIds:array({type:'integer',enum:ids}),goal:string,weeks:array(object({action:string,proof:string})),completion:string}),
  hint:object({text:string}),
  connection:object({ok:{type:'boolean'}})
};
export async function structuredCall(connection, instruction, data, schema, name, fetchImpl=fetch) {
  if (!connection.key) throw new Error('Подключите ИИ в настройках: нужен API-ключ');
  const format = {type:'json_schema',name,strict:true,schema};
  const messages = [{role:'system',content:instruction},{role:'user',content:JSON.stringify(data)}];
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
    if (error.name==='TimeoutError' || error.name==='AbortError') throw new Error('ИИ не ответил за 45 секунд. Повторите запрос; ход не сохранен.');
    throw new Error('Не удалось связаться с API. Проверьте адрес сервера и подключение.');
  }
  if (!response.ok) {
    if(response.status===429){
      let problem;try{problem=(await response.json())?.error;}catch{}
      const code=problem?.code||problem?.type;
      if(['insufficient_quota','billing_hard_limit_reached','billing_not_active'].includes(code))throw new Error('OpenAI: исчерпан баланс API или достигнут лимит расходов проекта. Проверьте Billing и Limits в OpenAI Platform. Подписка ChatGPT не заменяет оплату API. Ход не сохранен.');
      if(code==='rate_limit_exceeded')throw new Error('OpenAI: временно превышена скорость запросов. Подождите минуту и повторите. Ход не сохранен.');
    }
    const map={401:'API не принял ключ. Проверьте его в настройках.',403:'Нет доступа к выбранной модели или API.',429:'API сообщил о лимите запросов или баланса. Повторите позже.',400:'API не принял запрос. Проверьте модель и поддержку JSON Schema.',404:'Не найдена модель или адрес API.'};
    throw new Error(map[response.status] || `Ошибка сервиса ИИ (${response.status}). Ход не сохранен.`);
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
