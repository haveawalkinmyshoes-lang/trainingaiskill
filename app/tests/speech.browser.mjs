import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/kadry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.testSpeech={said:[],canceled:0,current:null};
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
    Object.defineProperty(window,'speechSynthesis',{value:{
      getVoices:()=>[{lang:'en-US',name:'English'},{lang:'ru-RU',name:'Russian'}],
      resume(){},cancel(){window.testSpeech.canceled++;window.testSpeech.current=null;},
      speak(u){window.testSpeech.current=u;window.testSpeech.said.push({text:u.text,lang:u.lang,voice:u.voice.name});}
    }});
  });
  await page.goto('http://127.0.0.1:8765');
  await page.locator('[data-topic="Управление временем"]').click();
  await page.locator('#position-input').fill('Бренд-менеджер г. Ижевск');
  await page.locator('.position-option').first().click();
  await page.locator('[data-scenario="TM01"]').click();await page.locator('#start-session').click();
  await page.locator('#chat-view').waitFor({state:'visible'});
  assert.equal((await page.evaluate(()=>testSpeech.said)).length,0,'Без согласия речь не запускается');
  const opening=await page.locator('.message-row.character .message-text').textContent();
  await page.locator('.speech-reply').click();
  assert.deepEqual((await page.evaluate(()=>testSpeech.said))[0],{text:opening,lang:'ru-RU',voice:'Russian'});
  assert.equal(await page.locator('.speech-reply').getAttribute('aria-pressed'),'true');
  await page.locator('.speech-reply').click();assert(await page.locator('#speech-stop').isDisabled());
  await page.locator('#speech-auto').check();
  assert.equal((await page.evaluate(()=>testSpeech.said)).length,2);
  await page.locator('#hint-button').click();await page.waitForFunction(()=>!document.querySelector('#hint-button').disabled);
  assert.equal((await page.evaluate(()=>testSpeech.said)).length,2,'Подсказка не перечитывает прежнюю реплику');
  await page.locator('#message-input').fill('К какому сроку нужна выгрузка?');await page.locator('#send-message').click();
  await page.waitForFunction(()=>document.querySelectorAll('.score-card').length===1&&!document.querySelector('#send-message').disabled);
  assert.equal((await page.evaluate(()=>testSpeech.said)).length,3,'Новый ответ озвучен один раз');
  assert.equal(await page.locator('.message-row.user .speech-reply').count(),0);
  assert.equal(await page.locator('.message-row.hint .speech-reply').count(),0);
  await page.locator('#speech-stop').click();
  await page.locator('.speech-reply').last().click();
  await page.evaluate(()=>testSpeech.current.onerror({error:'language-unavailable'}));
  assert.match(await page.locator('#speech-status').textContent(),/Не удалось/);
  assert(await page.locator('#speech-stop').isDisabled());
  await page.locator('.speech-reply').last().click();
  await page.locator('#finish-session').click();await page.locator('#result-view').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>testSpeech.current),null,'Разбор останавливает речь');
  assert.equal(await page.evaluate(()=>localStorage.getItem('nt-speech-auto')),'true');
  assert.deepEqual(errors,[]);
  const unsupported=await browser.newPage();
  await unsupported.addInitScript(()=>{delete window.speechSynthesis;delete window.SpeechSynthesisUtterance;});
  await unsupported.goto('http://127.0.0.1:8765');
  assert(await unsupported.locator('#speech-auto').isDisabled());
  assert.match(await unsupported.locator('#speech-status').textContent(),/не поддерживает/);
  console.log('Speech browser checks passed: manual, auto, Russian voice, no duplicates, stop, error, unsupported browser.');
}finally{await browser.close();}
