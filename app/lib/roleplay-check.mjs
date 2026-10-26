import {route} from './domain.mjs';
import {schemas} from './ai.mjs';
import {actorInput,actorConversation,actorInstruction,actorRoleViolation,conversationRoles} from './roleplay.mjs';
// Fixed synthetic cases only. Never accept employee identities, private dialogue or arbitrary prompts.
export async function checkRoleplay(library,connection,call){
  const operator=route(library.config,'SMART','ROLE_158','S07'),colleague=route(library.config,'Управление временем','ROLE_026','TM01');
  const a=text=>({role:'assistant',kind:'character',text}),u=text=>({role:'user',kind:'dialogue',text});
  const cases=[
    {id:'operator_handoff',context:operator,history:[a(operator.scenario.opening),u('Предложи план действий для увеличения закрытых обращений до 40 в смену за четыре недели.'),a('Предлагаю пилот на двух сменах в неделю: довести объем с 30 до 40 за четыре недели, удержать повторные обращения не выше 8%, контроль качества не ниже 92. При ухудшении остановлю эксперимент и сообщу вам.'),u('Да, запускай. Первый отчет через неделю.')]},
    {id:'repair_role_confusion',context:operator,history:[a(operator.scenario.opening),u('Качество оставим на текущем уровне. Пилот на двух сменах в неделю, первый отчет через неделю.'),a('Как руководитель отдела персонала, моя роль — поддерживать вас. Роман, какие ресурсы вам нужны для закрытия обращений?'),u('Роман — это ты, старший оператор. Я руководитель отдела персонала. Пилот и отчет уже согласовали. Подтверди свои действия и выполняй.')]},
    {id:'colleague_keeps_own_role',context:colleague,history:[a(colleague.scenario.opening),u('К какому сроку и для чего нужна выгрузка?'),a('Завтра к 12:00 для встречи. Работа займет полчаса, доступы есть.'),u('Я сделаю выгрузку завтра с 10:00 до 10:30 и пришлю тебе до 11:00. Подойдет?')]}
  ];
  const results=await Promise.allSettled(cases.map(async c=>{
    const session={context:c.context,difficulty:'начальный',steps:[{stageIds:[1,2,3,4]}],specialData:{planning:library.config.planning_tasks,warmup:library.config.warmup_items}};
    const actor=await call({...connection},actorInstruction(c.context),actorInput(session),schemas.actor,'trainer_actor',undefined,{conversation:actorConversation(c.history)});
    if(typeof actor?.reply!=='string'||actor.reply.length>8000||typeof actor.complete!=='boolean')throw Error('Invalid diagnostic actor response');
    return {case:c.id,participants:conversationRoles(c.context),reply:actor.reply,complete:actor.complete,roleViolation:actorRoleViolation(actor.reply,c.context)};
  }));
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  return {scope:'fixed_synthetic_cases',model:connection.model,calls:cases.length,results:results.map(r=>r.value)};
}
