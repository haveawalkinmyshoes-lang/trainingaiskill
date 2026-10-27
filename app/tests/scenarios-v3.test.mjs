import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadLibrary,route} from '../lib/domain.mjs';
import {Trainer} from '../lib/trainer.mjs';
import {actorInput,actorInstruction} from '../lib/roleplay.mjs';
import {validateLearning,contractProgress,outcomeFor} from '../lib/learning.mjs';
const library=await loadLibrary(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url));
const config=library.config,context=route(config,'SMART','ROLE_158','S07');
const message='Предлагаю конкретные действия, проверку результата и согласование ресурса.';
const rows=(scenario,source='independent',score=2)=>scenario.learning_rubric.map(c=>({id:c.id,score,quote:source==='unobserved'?'':message,reason:'Тестовый факт',source}));
const conditions=(scenario,state='confirmed')=>scenario.training_contract.requirements.map(c=>({id:c.id,state,quote:state==='confirmed'?message:''}));
test('Все 45 карточек имеют отдельные предметные критерии и условия, а не одинаковую основу оценки',()=>{
  assert.equal(config.scenarios.length,45);assert.equal(config.scenario_revision,'3.0');
  for(const s of config.scenarios){assert.equal(s.revision,'3.0');assert.equal(s.learning_rubric.length,5);assert.equal(s.training_contract.requirements.length,5);assert.equal(new Set(s.dialogue_flow.map(f=>f.evaluation_basis)).size,5);assert.equal(new Set(s.learning_rubric.map(c=>c.id)).size,5);assert(s.good.includes('предложил участник'));assert(!s.bad.includes('Постараюсь'));assert(s.monthly_homework.final_check.includes('10-й'));}
  const by=id=>config.scenarios.find(s=>s.id===id);
  assert(by('S02').hidden.includes('Загрузка следующей недели неизвестна'));assert(!by('S02').good.includes('среде'));
  assert(by('S09').hidden.includes('маржа'));assert(by('S12').hidden.includes('согласием на связь'));assert(by('TM13').hidden.includes('НДС'));assert(by('TM14').hidden.includes('включают ручную сверку'));
});
test('Должностная матрица и источники целей не изменены при исправлении сценариев',()=>{
  assert.equal(createHash('sha256').update(JSON.stringify([config.job_profiles,config.competency_dictionary,config.scenario_competency_map])).digest('hex'),'bd89d7a509e291febb32886b8f6f43a87babe3eb431f7a8f6b65d312c1233935');
});
test('Слова персонажа и пустое согласие не могут закрыть условия; чужая цитата отклоняется',()=>{
  const s={context,conditions:[],warmup:null};
  assert(!contractProgress(s,{complete:true},[message],message).complete);
  const bare=conditions(context.scenario).map(c=>({...c,quote:'Да'}));assert(!contractProgress(s,{complete:true,conditions:bare},['Да'],'Да').complete);
  assert.throws(()=>contractProgress(s,{conditions:conditions(context.scenario)},['Чужая реплика'],'Чужая реплика'),/не подтверждено/);
  assert.throws(()=>contractProgress(s,{conditions:conditions(context.scenario).slice(1)},[message],message),/Не все/);
  const partial=conditions(context.scenario);partial[4]={id:'C5',state:'open',quote:''};assert(!contractProgress(s,{complete:true,conditions:partial},[message],message).complete);
  assert(contractProgress(s,{complete:false,conditions:conditions(context.scenario)},[message],message).complete,'Подтвержденные условия завершают цикл без лишнего вопроса модели');
});
test('Учебные баллы изолированы от матрицы; помощь ограничивает балл, а отсутствие данных сохраняет null',()=>{
  const scenario=context.scenario;
  assert.equal(validateLearning(rows(scenario,'prompted',3),scenario,[message],{all:true}).total,1);
  assert.equal(validateLearning(rows(scenario,'unobserved',null),scenario,[message],{all:true}).total,null);
  assert.equal(validateLearning(rows(scenario),scenario,[message],{all:true}).total,2);
  assert.throws(()=>validateLearning(rows(scenario).map(r=>({...r,quote:'слова персонажа'})),scenario,[message],{all:true}));
  assert.throws(()=>validateLearning(rows(scenario).slice(0,4),scenario,[message],{all:true}));
  assert.throws(()=>validateLearning(rows(scenario,'unobserved',1),scenario,[message],{all:true}));
});
test('Все 45 сценариев проходят локальный конвейер с тестовым провайдером: ранний финал блокируется, цитаты и два слоя сохраняются',async()=>{
  let calls=0;
  for(const scenario of config.scenarios){
    const profile=config.job_profiles.find(p=>{try{route(config,scenario.topic,p.id,scenario.id);return true;}catch{return false;}});assert(profile,scenario.id);
    let actorTurns=0;const trainer=new Trainer(library,async(_,instruction,data,schema,name)=>{
      calls++;assert(!instruction.includes('SENSITIVE'));
      if(name==='trainer_actor'){actorTurns++;const values=conditions(scenario,actorTurns===1?'open':'confirmed');return {reply:'Условия обсуждены в рамках учебной проверки.',complete:true,stageIds:[1,2,3,4,5],conditions:values,...(scenario.id==='S05'?{itemDecision:{item:data.warmupProgress.index+1,verdict:actorTurns===1?'needs_revision':'accepted'}}:{})};}
      const base={scores:data.competencies.map(c=>({id:c.id,score:1,quote:message,reason:'Тестовая компетенция'})),learning:rows(scenario)};
      return name==='trainer_grade'?base:{...base,summary:'Тестовый разбор',strengths:[{text:'Тестовое действие',quote:message}],growth:'Практиковать действие',outcome:'achieved'};
    });
    const view=trainer.start('synthetic-local',{topic:scenario.topic,scenarioId:scenario.id,profileId:profile.id,mode:'ai'},{key:'offline-fixture'}),s=trainer.get(view.id,'synthetic-local');
    await trainer.turn(s,message,'one');assert(!s.complete,scenario.id);assert.equal(s.steps[0].score,2);assert.equal(s.steps[0].competencyScore,1);
    const partial=await trainer.finalize(s);assert.equal(partial.report.outcome,'partial');assert.equal(partial.report.total,2);assert.equal(partial.report.competencyTotal,1);assert.equal(partial.report.learning.scores.length,5);assert.equal(partial.report.assessmentVersion,3);
  }
  assert.equal(calls,135); // Three mock calls per scenario; no real API.
});
test('S05 хранит текущую задачу, не принимает чужой номер, допускает только явный пропуск и частичный итог',()=>{
  const scenario=config.scenarios.find(s=>s.id==='S05'),s={context:{...context,scenario},warmup:{index:0,items:[]},conditions:[]};
  const input=actorInput({...s,steps:[],specialData:{warmup:config.warmup_items}});assert.equal(input.specialData.task,config.warmup_items[0].task);assert(!Array.isArray(input.specialData));
  assert.throws(()=>contractProgress(s,{conditions:conditions(scenario),itemDecision:{item:2,verdict:'accepted'}},[message],message),/текущее задание/);
  const open=contractProgress(s,{complete:true,conditions:conditions(scenario,'open'),itemDecision:{item:1,verdict:'needs_revision'}},[message],message);assert.equal(open.warmup.index,0);assert(!open.complete);
  const accepted=contractProgress(s,{conditions:conditions(scenario),itemDecision:{item:1,verdict:'accepted'}},[message],message);assert.equal(accepted.warmup.index,1);assert(!accepted.complete);
  const skipped=contractProgress(s,{conditions:conditions(scenario,'open'),itemDecision:{item:1,verdict:'skipped'}},['пропустить'],'пропустить');assert.equal(skipped.warmup.items[0],'skipped');
  assert.equal(contractProgress(s,{conditions:conditions(scenario,'open'),itemDecision:{item:1,verdict:'skipped'}},['готов дальше'],'готов дальше').warmup.index,0);
  assert.equal(outcomeFor({...s,warmup:{index:5,items:Array(5).fill('skipped')}},'achieved'),'partial');assert.equal(outcomeFor({...s,warmup:{index:5,items:Array(5).fill('accepted')}},'achieved'),'achieved');
  assert(actorInstruction(s.context).includes('Не переключай задачу сам'));
});
test('Сложная планерка вводит двухчасовую рекламацию до четверга и не закрывается до ее появления',()=>{
  const scenario=config.scenarios.find(s=>s.id==='TM03'),s={context:{...context,scenario},conditions:[],warmup:null,difficulty:'сложный',steps:[]};
  assert(!contractProgress(s,{conditions:conditions(scenario),complete:true},[message],message).complete);
  assert.equal(actorInput(s).planningIncident,null);s.steps=Array(3).fill({stageIds:[]});const incident=actorInput(s).planningIncident;assert.equal(incident.hours,2);assert(incident.deadline.includes('четверг'));assert(contractProgress(s,{conditions:conditions(scenario)},[message],message).complete);
});
test('S05 проходит пять принятых заданий последовательно; повтор запроса не переключает задачу второй раз',async()=>{
  const scenario=config.scenarios.find(s=>s.id==='S05'),profile=config.job_profiles.find(p=>{try{route(config,scenario.topic,p.id,scenario.id);return true;}catch{return false;}});let calls=0;
  const trainer=new Trainer(library,async(_,instruction,data,schema,name)=>{calls++;if(name==='trainer_actor')return {reply:'Формулировка текущей задачи принята.',stageIds:[1,2,3,4,5],complete:true,conditions:conditions(scenario),itemDecision:{item:data.warmupProgress.index+1,verdict:'accepted'}};const base={scores:data.competencies.map(c=>({id:c.id,score:1,quote:message,reason:'Тест'})),learning:rows(scenario)};return name==='trainer_grade'?base:{...base,summary:'Пять задач пройдены.',strengths:[],growth:'Практика',outcome:'achieved'};});
  const view=trainer.start('local',{topic:scenario.topic,scenarioId:scenario.id,profileId:profile.id,mode:'ai'},{key:'offline'}),s=trainer.get(view.id,'local');
  for(let i=0;i<5;i++){await trainer.turn(s,message,'item-'+i);assert.equal(s.warmup.index,i+1);assert.equal(s.complete,i===4);if(i<4){assert(s.history.at(-1).text.includes('Следующая задача '+(i+2)));assert.deepEqual(s.conditions,[]);}await trainer.turn(s,message,'item-'+i);assert.equal(s.warmup.index,i+1);}
  assert.equal(calls,10);await trainer.finalize(s);assert.equal(s.report.outcome,'achieved');assert.equal(calls,11);
});
