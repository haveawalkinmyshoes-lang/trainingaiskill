import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteOptions} from '../lib/evidence.mjs';
import {schemas} from '../lib/ai.mjs';
import {validateScores,loadLibrary} from '../lib/domain.mjs';
import {Trainer} from '../lib/trainer.mjs';

test('Фрагменты цитат дословные, ограничены по размеру и сохраняют начало и конец длинных реплик',()=>{
  const messages=Array.from({length:12},(_,i)=>`Начало ${i}: «Согласуем срок». `+('Данные\tпо  клиентам\nи задача 🙂. '.repeat(200)).slice(0,5500)+` Конец ${i}: до 17:00.`);
  const options=quoteOptions(messages);
  assert(options.length<=96);assert(options.every(q=>q.length<=240&&q.length>0&&messages.some(m=>m.includes(q))));
  for(let i=0;i<12;i++){assert(options.some(q=>q.includes('Начало '+i)));assert(options.some(q=>q.includes('Конец '+i)));}
  const exact='Какой\tсрок?  Давайте «сверим» завтра 🙂.';
  assert.deepEqual(quoteOptions([exact],30),[exact]);
});
test('Схема запрещает пустую или придуманную цитату для положительного балла; сервер также отклоняет подмену',()=>{
  const message='Давайте согласуем результат и срок.';
  const options=quoteOptions([message],30),schema=schemas.grade([38],options);
  const [positive,unobserved]=schema.properties.scores.items.anyOf;
  assert.deepEqual(positive.properties.quote.enum,[message]);assert(!positive.properties.quote.enum.includes(''));
  assert(positive.properties.score.enum.every(x=>x>0));assert(unobserved.properties.score.enum.includes(null));
  const cs=[{id:38}];
  assert.throws(()=>validateScores([{id:38,score:2,quote:'Перефразированная мысль',reason:'test'}],cs,[message]),/не подтверждена/);
  assert.throws(()=>validateScores([{id:38,score:2,quote:'',reason:'test'}],cs,[message]),/не подтверждена/);
  assert.doesNotThrow(()=>validateScores([{id:38,score:2,quote:message,reason:'test'}],cs,[message]));
});
test('Ход оценивается по текущей реплике, финал по пользовательским репликам, без дополнительного запроса к модели',async()=>{
  const library=await loadLibrary(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url));
  const requests=[];
  const trainer=new Trainer(library,async(connection,instruction,input,schema,name)=>{
    requests.push(name);
    if(name==='trainer_actor')return {reply:'РЕПЛИКА ПЕРСОНАЖА',stageIds:[1],complete:false};
    const options=schema.properties.scores.items.anyOf[0].properties.quote.enum;
    assert(options.every(q=>input.history.some(m=>m.role==='user'&&m.text.includes(q))));
    assert(!options.includes('РЕПЛИКА ПЕРСОНАЖА'));
    if(name==='trainer_grade')assert(options.every(q=>input.history.at(-1).text.includes(q)));
    const scores=input.competencies.map(c=>({id:c.id,score:1.5,quote:options[0],reason:'Уточнен срок'}));
    if(name==='trainer_grade')return {scores};
    assert(schema.properties.strengths.items.properties.quote.enum.includes(options[0]));
    return {scores,summary:'Разбор',growth:'Практика',strengths:[{text:'Уточнение',quote:options[0]}],outcome:'partial'};
  });
  const s=trainer.start('owner',{topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'ai'},{key:'fixture'});
  const stored=trainer.get(s.id,'owner');
  await trainer.turn(stored,'К какому сроку нужны данные?','1');
  await trainer.turn(stored,'Давайте согласуем результат и проверим возможность переноса.','2');
  await trainer.finalize(stored);
  assert.equal(requests.length,5);assert.equal(stored.report.total,1.5);assert.equal(stored.steps.length,2);
});
