import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLibrary} from '../lib/domain.mjs';
import {Trainer} from '../lib/trainer.mjs';
const library=await loadLibrary(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url));
const input={topic:'Управление временем',profileId:'ROLE_026',scenarioId:'TM01',mode:'demo'};
test('Ограничены открытые диалоги и подсказки; завершение освобождает место',async()=>{
  const trainer=new Trainer(library),sessions=Array.from({length:3},()=>trainer.start('owner',input,{}));
  assert.throws(()=>trainer.start('owner',input,{}),/три открытых/);
  const session=trainer.get(sessions[0].id,'owner');
  for(let n=0;n<3;n++)await trainer.hint(session);
  await assert.rejects(()=>trainer.hint(session),/три подсказки/);
  session.complete=true;assert(trainer.start('owner',input,{}));
});
test('Истекший диалог закрыт при чтении; команды не создают неограниченную историю',async()=>{
  const trainer=new Trainer(library),view=trainer.start('owner',input,{}),session=trainer.get(view.id,'owner');
  session.createdAt=Date.now()-13*60*60*1000;assert.throws(()=>trainer.get(view.id,'owner'),/не найдена/);
  const fresh=trainer.start('owner',input,{}),s=trainer.get(fresh.id,'owner');
  for(let n=0;n<40;n++)await trainer.turn(s,n%2?'Продолжить':'Пауза','cmd-'+n);
  await assert.rejects(()=>trainer.turn(s,'Пауза','cmd-last'),/лимит длины/);
  assert.equal((await trainer.finalize(s)).complete,true);
});
