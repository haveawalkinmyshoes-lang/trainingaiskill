import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadLibrary,route,publicCatalog,availableScenarios,halfMean,nextMonth,validateScores } from '../lib/domain.mjs';
const library=await loadLibrary(fileURLToPath(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url)));
const c=library.config;
test('Городской бренд-менеджер относится к продажам, а городской псевдоним не остается в маркетинге',()=>{
  const p=c.job_profiles.find(p=>p.title==='Бренд-менеджер г. Ижевск');assert.equal(p.family,'Продажи');
  assert.deepEqual(p.targets,c.job_profiles.find(p=>p.id==='ROLE_026').targets);
  assert(!publicCatalog(c).profiles.find(p=>p.id==='ROLE_070').aliases.includes(p.title));
});
test('Оценка только в пределах выбранной темы и реального профиля',()=>{
  const ctx=route(c,'Управление временем','ROLE_BRAND_SALES_01','TM01');
  assert.deepEqual(ctx.competencies.map(x=>x.id).sort((a,b)=>a-b),[37,38]);assert(ctx.competencies.every(x=>x.target===1));
  assert.throws(()=>route(c,'SMART','ROLE_BRAND_SALES_01','TM01'));
  assert.throws(()=>route(c,'SMART','ROLE_203','S01'));
  assert.throws(()=>route(c,'SMART','unknown','S01'));
});
test('Все 250 должностей имеют допустимый диалог в каждой из трех тем',()=>{
  assert.equal(c.job_profiles.length,250);assert.equal(c.scenarios.length,45);
  for(const p of c.job_profiles)for(const topic of c.ui.topic_selector.options)assert(availableScenarios(c,topic,p.id).length,`${p.id} / ${topic}`);
});
test('Публичный каталог не раскрывает скрытые факты и условия уступки',()=>{
  const text=JSON.stringify({catalog:publicCatalog(c),scenarios:availableScenarios(c,'SMART','ROLE_018')});
  assert(!text.includes('"hidden"'));assert(!text.includes('"good"'));assert(!text.includes('"reveal_on"'));
  const cases=availableScenarios(c,'SMART','ROLE_018');assert(!JSON.stringify(cases).includes(c.scenarios.find(s=>s.id==='S02').hidden));
});
test('Половинные оценки сохраняют ноль и не превращают отсутствие данных в ноль',()=>{
  assert.equal(halfMean([0,1]),.5);assert.equal(halfMean([null]),null);assert.equal(halfMean([2,2.5]),2.5);
  for(const v of [0.1,3.5,-.5,NaN,Infinity])assert.throws(()=>halfMean([v]));
});
test('Даты практики корректны на смене года и в високосном феврале',()=>{
  assert.equal(nextMonth('2026-10-21').end,'2026-11-30');assert.equal(nextMonth('2026-12-21').start,'2027-01-01');assert.equal(nextMonth('2028-01-21').end,'2028-02-29');
});
test('Оценщик не может подменить компетенцию, цитату или шкалу',()=>{
  const ctx=route(c,'Управление временем','ROLE_BRAND_SALES_01','TM01');
  assert.throws(()=>validateScores([{id:4,score:2,quote:'срок'}],ctx.competencies,['срок']));
  assert.throws(()=>validateScores([{id:38,score:2,quote:'несуществующее'}],ctx.competencies,['срок']));
  assert.throws(()=>validateScores([{id:38,score:1.2,quote:'срок'}],ctx.competencies,['срок']));
  assert.throws(()=>validateScores([{id:38,score:2,quote:''}],ctx.competencies,['срок']));
});
