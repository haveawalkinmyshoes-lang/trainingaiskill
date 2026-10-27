import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLibrary,route} from '../lib/domain.mjs';
import {Trainer} from '../lib/trainer.mjs';
import {schemas,structuredCall} from '../lib/ai.mjs';
import {conversationRoles,actorInput,actorInstruction,actorConversation,actorRoleViolation} from '../lib/roleplay.mjs';
import {checkRoleplay} from '../lib/roleplay-check.mjs';
const library=await loadLibrary(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url));
const context=route(library.config,'SMART','ROLE_158','S07');
test('Роман остается оператором, HR остается участником: нет конфликтующей роли карточки, общей инструкции ведущего и оценщика',()=>{
  const participants=conversationRoles(context);assert.equal(participants.character.name,'Роман');assert.equal(participants.character.role,'старший оператор');assert.equal(participants.learner.role,'Руководитель отдела персонала');
  const input=actorInput({context,steps:[],difficulty:'начальный'}),instruction=actorInstruction(context);
  assert.equal(input.scenario.learner_role,participants.learner.role);assert(!JSON.stringify(input).includes('Руководитель поддержки'));assert(!('competencies' in input));assert(!('history' in input));
  assert(!instruction.includes('Ты — Нейротренер'));assert(!instruction.includes('выведи короткую оценку шага'));assert(instruction.includes('Роман, старший оператор'));assert(instruction.includes('Обращения')||instruction.includes('обращения обрабатываешь ты'));assert(instruction.includes('complete=true'));
});
test('История идет нативными ролями API; подсказки и технические сообщения не становятся репликами персонажа',async()=>{
  const history=[{role:'assistant',kind:'character',text:'Открытие'},{role:'user',kind:'dialogue',text:'Вопрос'},{role:'assistant',kind:'hint',text:'Не речь Романа'},{role:'assistant',kind:'notice',text:'Пауза'},{role:'assistant',kind:'character',text:'Ответ'},{role:'user',text:'Запускай'}];
  const conversation=actorConversation(history);assert.deepEqual(conversation.map(m=>m.role),['assistant','user','assistant','user']);assert(!JSON.stringify(conversation).includes('Не речь Романа'));
  for(const style of ['responses','chat']){
    let body;await structuredCall({key:'fixture',base:'https://api.openai.com/v1',model:'fixture',style},'role binding',{participants:conversationRoles(context)},schemas.actor,'trainer_actor',async(_,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>style==='chat'?{choices:[{message:{content:'{"reply":"Запускаю","stageIds":[4],"complete":true}'}}]}:{status:'completed',output:[{content:[{type:'output_text',text:'{"reply":"Запускаю","stageIds":[4],"complete":true}'}]}]}};},{conversation});
    const messages=body.input||body.messages;assert.equal(messages[0].role,'system');assert.deepEqual(messages.slice(2),conversation);assert.equal(messages.at(-1).content,'Запускай');
  }
});
test('Проверка ловит обе подмены из проваленного теста, но допускает правильную роль и передачу отчета руководителю',()=>{
  for(const reply of ['Как руководитель отдела персонала, моя ответственность — поддерживать вашу работу.','Я — руководитель отдела персонала.',' Я руководитель отдела персонала, а вы выполняйте задачу.'])assert.equal(actorRoleViolation(reply,context),'learner_role_claimed');
  for(const reply of ['Роман, понимаю вашу позицию.','Понял. Роман, какие ресурсы вам нужны?'])assert.equal(actorRoleViolation(reply,context),'character_name_used_for_learner');
  for(const reply of ['Я Роман, старший оператор. Запущу пилот и пришлю вам отчет через неделю.','Вы как руководитель отдела персонала согласовали пилот. Я подготовлю отчет.','Я передам руководителю отдела персонала результаты.'])assert.equal(actorRoleViolation(reply,context),null);
});
test('Персонаж получает одну попытку исправления; неверная личность не сохраняется, оценщик не вызывается повторно',async()=>{
  let actors=0,grades=0;const trainer=new Trainer(library,async(_,instruction,input,schema,name,fetchImpl,transport)=>{
    if(name==='trainer_actor'){actors++;assert.equal(transport.conversation.at(-1).role,'user');assert(!transport.conversation.some(m=>m.content.startsWith('Как руководитель отдела персонала')));if(actors===1)return {reply:'Как руководитель отдела персонала, поддержу вас.',stageIds:[1],complete:false};assert(instruction.includes('отклонена проверкой ролей'));return {reply:'Я Роман, старший оператор. Запускаю пилот и пришлю вам отчет через неделю.',stageIds:[4,5],complete:true};}
    grades++;return {scores:input.competencies.map(c=>({id:c.id,score:null,quote:'',reason:'Недостаточно данных'}))};
  });
  const v=trainer.start('test',{topic:'SMART',profileId:'ROLE_158',scenarioId:'S07',mode:'ai'},{key:'fixture'}),s=trainer.get(v.id,'test');const input='Да, запускай. Первый отчет через неделю.';
  await trainer.turn(s,input,'turn-1');assert.equal(actors,2);assert.equal(grades,1);assert.equal(s.steps.length,1);assert(!s.complete,'Исправление роли не подтверждает отсутствующие условия пилота');assert(!s.history.some(m=>m.text.includes('поддержу вас')));
  await trainer.turn(s,input,'turn-1');assert.equal(actors,2);assert.equal(grades,1);
});
test('Повторная подмена роли отклоняется без записи реплики и оценки',async()=>{
  const trainer=new Trainer(library,async(_,instruction,input,schema,name)=>name==='trainer_actor'?{reply:'Роман, выполняйте работу на месте.',stageIds:[1],complete:false}:{scores:input.competencies.map(c=>({id:c.id,score:null,quote:'',reason:'Недостаточно данных'}))});
  const v=trainer.start('test',{topic:'SMART',profileId:'ROLE_158',scenarioId:'S07',mode:'ai'},{key:'fixture'}),s=trainer.get(v.id,'test');await assert.rejects(()=>trainer.turn(s,'Выполняй','one'),/Персонаж перепутал роль/);assert.equal(s.history.length,1);assert.equal(s.steps.length,0);assert.equal(s.seen.size,0);assert(!s.busy);
});
test('Синтетическая диагностика ограничена тремя примерами и не читает реальные сессии',async()=>{
  const calls=[];const result=await checkRoleplay(library,{key:'fixture',model:'fixture'},async(_,instruction,input,schema,name,fetchImpl,transport)=>{calls.push({input,transport});return {reply:'Подтверждаю договоренность.',stageIds:[5],complete:true};});
  assert.equal(result.calls,3);assert.equal(calls.length,3);assert.deepEqual(result.results.map(r=>r.case),['operator_handoff','repair_role_confusion','colleague_keeps_own_role']);assert(result.results.every(r=>r.roleViolation===null));assert(calls.every(c=>c.transport.conversation.at(-1).role==='user'));assert.equal(calls[0].input.participants.character.name,'Роман');assert.equal(calls[2].input.participants.character.name,'Елена');
});
