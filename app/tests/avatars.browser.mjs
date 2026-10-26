import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/kadry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const app=await createApp({accessRequired:true,codeVerification:false,employeeAllowlist:[{fullName:'Сидоров Антон',profileId:'ROLE_026'},{fullName:'Сидорова Анна',profileId:'ROLE_026'}],bridgeSettings:{token:''},connection:{key:''}});
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await mkdir('../.work/ui-avatars',{recursive:true});
  const base='http://127.0.0.1:'+app.server.address().port;let checkedPages=0;
  async function checkUnique(){
    assert.equal(await page.locator('.portrait-neutral:visible').count(),0,'No letter placeholders');
    assert.equal(await page.locator('.scenario-card:visible').count(),await page.locator('.scenario-card:visible img').count(),'Every visible scenario card must show a portrait');
    await page.waitForFunction(()=>[...document.querySelectorAll('img.portrait,img.portrait-small')].filter(n=>n.checkVisibility()).every(n=>n.complete&&n.naturalWidth>0));
    const images=await page.locator('img.portrait,img.portrait-small').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()).map(n=>({src:n.getAttribute('src'),gender:n.dataset.avatarGender})));
    assert.equal(new Set(images.map(i=>i.src)).size,images.length,'Visible portraits must not repeat');for(const i of images)assert(i.src.includes('/'+i.gender+'-'));checkedPages++;
  }
  for(const [name,gender]of [['Сидоров Антон','male'],['Сидорова Анна','female']]){
    await page.goto(base);await page.locator('#login-full-name').fill(name);await page.locator('#login-submit').click();await page.locator('#employee-top-avatar img').waitFor();assert.match(await page.locator('#employee-top-avatar img').getAttribute('src'),new RegExp('/'+gender+'-'));
    await checkUnique();
    for(const topic of ['SMART','Обратная связь','Управление временем']){
      await page.locator('#new-training').click();await page.locator('[data-topic="'+topic+'"]').click();await page.locator('.scenario-card').first().waitFor();
      while(true){await checkUnique();const more=page.getByRole('button',{name:'Следующие ситуации',exact:true});if(!await more.isVisible()||await more.isDisabled())break;await more.click();}
    }
    await page.locator('#new-training').click();await page.locator('[data-topic="Управление временем"]').click();await page.locator('[data-scenario="TM01"]').waitFor();
    const face=await page.locator('[data-scenario="TM01"] img').getAttribute('src');await page.screenshot({path:`../.work/ui-avatars/${gender}-selection.png`,fullPage:true});
    await page.locator('[data-scenario="TM01"]').click();assert.equal(await page.locator('#detail-character-avatar img').getAttribute('src'),face);assert.match(await page.locator('#detail-user-avatar img').getAttribute('src'),new RegExp('/'+gender+'-'));assert.equal(await page.locator('.run-mode,#mode-ai,#mode-demo,#start-note').count(),0);await checkUnique();
    await page.locator('#start-session').click();await page.locator('#chat-view').waitFor({state:'visible'});assert.equal(await page.locator('#person-avatar img').getAttribute('src'),face);
    await page.locator('#message-input').fill('К какому сроку нужна задача?');await page.locator('#send-message').click();await page.waitForFunction(()=>!document.querySelector('#message-input').disabled&&document.querySelectorAll('.score-card').length===1);
    await checkUnique();assert.equal(await page.locator('#messages img,#messages .avatar').count(),0);
    await page.reload();await page.locator('#chat-view').waitFor({state:'visible'});assert.equal(await page.locator('#person-avatar img').getAttribute('src'),face);await checkUnique();
    await page.screenshot({path:`../.work/ui-avatars/${gender}-chat.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});assert(await page.locator('#employee-top-avatar img').isVisible());assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));await checkUnique();await page.screenshot({path:`../.work/ui-avatars/${gender}-mobile.png`,fullPage:true});
    await page.locator('#sign-out').click();await page.locator('#login-view').waitFor({state:'visible'});await page.setViewportSize({width:1440,height:1000});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',checkedPages,genderedAccounts:2,consoleErrors:errors}));
}finally{await browser.close();app.server.closeAllConnections();app.server.close();}
