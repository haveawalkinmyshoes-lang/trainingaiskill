import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLibrary} from '../lib/domain.mjs';
import {accountPortrait,avatarGender,scenarioPortraitPages} from '../public/avatars.js';
test('Пол портрета: имя, отчество, явное значение; неоднозначные имена и должности нейтральны',()=>{
  for(const name of ['Сидоров Антон','Антон Сидоров','Петр','Сергей','Артём'])assert.equal(avatarGender(name),'male');
  for(const name of ['Иванова Анна','Юлия','Любовь','Елена, коллега','Саша Сергеевна'])assert.equal(avatarGender(name),'female');
  assert.equal(avatarGender('Женя Петрович'),'male');assert.equal(avatarGender('Alex','F'),'female');
  for(const name of ['Саша','Женя','Непосредственный руководитель','Тренер по SMART','Неизвестное имя'])assert.equal(avatarGender(name),null);
  assert.equal(accountPortrait('Саша'),null);assert.match(accountPortrait('Иванова Анна'),/female-/);assert.match(accountPortrait('Сидоров Антон'),/male-/);
});
test('На каждой странице портреты уникальны, соответствуют полу и не повторяют портрет сотрудника; сценарии не теряются',async()=>{
  const {config}=await loadLibrary(new URL('../../02_Инструкция_модели_Нейротренера.md',import.meta.url));
  for(const employee of ['Иванов Иван','Иванова Анна','Неизвестный Участник'])for(const topic of ['SMART','Обратная связь','Управление временем']){
    const scenarios=config.scenarios.filter(s=>s.topic===topic),reserved=accountPortrait(employee),pages=scenarioPortraitPages(scenarios,reserved);
    assert.deepEqual(pages.flat().map(x=>x.scenario.id),scenarios.map(s=>s.id));
    for(const page of pages){const images=page.map(x=>x.src).filter(Boolean);if(reserved)images.push(reserved);assert.equal(images.length,new Set(images).size);assert(page.length<=6);for(const p of page)if(p.src)assert(p.src.startsWith('/avatars/'+p.gender+'-'));}
    assert.deepEqual(scenarioPortraitPages(scenarios,reserved),pages);
  }
  const list=Array.from({length:10},(_,i)=>({id:String(i),character:`Иван, менеджер ${i}`})),pages=scenarioPortraitPages(list,accountPortrait('Иванов Иван'));
  assert(pages.every(p=>p.length<=3));assert.equal(pages.flat().length,10);
});
