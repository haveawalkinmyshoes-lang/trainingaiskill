const $=id=>document.getElementById(id);
const state={catalog:null,topic:'',profile:null,scenario:null,scenarios:[],mode:'demo',session:null,busy:false,csrf:'',connection:null,optionIndex:-1,options:[],pending:null,setupStage:1};
const fmt=value=>value===null||value===undefined?'—':new Intl.NumberFormat('ru',{maximumFractionDigits:1}).format(value);
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
function uiIcon(name){
  const paths={plus:['M12 5v14M5 12h14'],bookmark:['M7 3h10a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2Z'],sliders:['M5 3v7m0 4v7M12 3v3m0 4v11M19 3v11m0 4v3','M3 10h4v4H3zM10 6h4v4h-4zM17 14h4v4h-4z'],send:['M21 3 3 10l7 4 4 7 7-18Z','m10 14 6-6'],share:['M12 16V3m-4 4 4-4 4 4','M6 10H4v11h16V10h-2'],search:['M20 20l-5-5','M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'],close:['m6 6 12 12M18 6 6 18'],arrow:['M4 12h16m-6-6 6 6-6 6'],back:['M20 12H4m6-6-6 6 6 6'],bulb:['M9 18h6m-5 3h4','M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3Z'],check:['m5 12 4 4L19 6']};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ui-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  for(const d of paths[name]||paths.arrow){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}
function decorateInterface(){
  for(const [selector,name]of [['#new-training .nav-icon','plus'],['#show-result .nav-icon','bookmark'],['#settings-close','close']])document.querySelector(selector)?.replaceChildren(uiIcon(name));
  $('settings-open').prepend(uiIcon('sliders'));
  for(const [id,label,name]of [['send-message','Ответить','send'],['hint-button','Подсказка','bulb'],['download-result','Скачать разбор','share']])$(id).replaceChildren(uiIcon(name),document.createTextNode(label));
  for(const button of document.querySelectorAll('button')){
    const textNodes=[...button.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&/[↗→←]/.test(n.textContent));
    for(const node of textNodes){const back=node.textContent.includes('←');node.textContent=node.textContent.replace(/[↗→←]/g,'').trim();if(back)button.prepend(uiIcon('back'));else button.append(uiIcon('arrow'));}
    for(const span of [...button.querySelectorAll('span')])if(/^[↗→]$/.test(span.textContent.trim()))span.replaceWith(uiIcon('arrow'));
  }
}
const norm=s=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,7500);}
async function api(path,data){
  const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',
    headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:data===undefined?undefined:JSON.stringify(data)});
  let value;try{value=await response.json();}catch{throw new Error('Нет ответа сервера. Запустите «Запустить Нейротренер.cmd».');}
  if(!response.ok){if(response.status===401&&!path.startsWith('auth/'))showLogin('Сессия завершена. Войдите снова.');throw new Error(value.error||'Не удалось выполнить запрос');}return value;
}

function busy(value){state.busy=value;document.body.classList.toggle('busy',value);for(const id of ['start-session','send-message','finish-session','hint-button','make-plan','message-input','review-complete'])$(id).disabled=value;if(!value)document.querySelectorAll('.pending-message').forEach(n=>n.remove());}
function showView(name){for(const id of ['setup','chat','result'])$(id+'-view').hidden=id!==name;$('new-training').classList.toggle('active',name!=='result');$('show-result').classList.toggle('active',name==='result');window.scrollTo({top:0,behavior:'smooth'});}
function updateBadge(){$('settings-open').classList.toggle('connected',Boolean(state.connection?.configured));$('connection-caption').textContent=state.connection?.configured?state.connection.model:'Ключ не добавлен';}
function setRunMode(mode){
  state.mode=mode==='ai'&&!state.connection?.configured?'demo':mode;
  for(const value of ['demo','ai']){$('mode-'+value).classList.toggle('selected',state.mode===value);$('mode-'+value).setAttribute('aria-pressed',String(state.mode===value));}
  $('mode-ai').disabled=!state.connection?.configured;
  $('mode-ai').title=state.connection?.configured?'Диалог и оценка с ИИ':'ИИ пока не подключен';
  $('start-session').replaceChildren(document.createTextNode(state.mode==='demo'?'Начать разговор':'Начать разговор с ИИ'),uiIcon('arrow'));
  $('start-note').textContent=state.mode==='demo'?'Ответы по шаблону. Оценки условные.':'Живые ответы ИИ. Разбор — после разговора.';
  $('setup-mode-notice').hidden=Boolean(state.connection?.configured);
  $('setup-mode-notice').textContent=state.connection?.configured?'':'Сейчас доступен режим по сценарию. Оценки условные.';
  updateBadge();
}
function setSetupStage(stage,{focus=true}={}){
  state.setupStage=stage===1?1:3;stepper();
  if(focus){const heading=$(state.setupStage===1?'topic-section':'scenario-section').querySelector('h2');heading.focus({preventScroll:true});heading.scrollIntoView({behavior:'smooth',block:'start'});}
}
function stepper(){
  for(const [id,stage]of [['topic',1],['scenario',3]]){
    const node=$('step-'+id),button=$('goto-'+id);node.classList.toggle('current',state.setupStage===stage);node.classList.toggle('done',stage<state.setupStage);
    if(stage===state.setupStage)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
    button.disabled=stage===3&&!state.topic;$(id+'-section').hidden=stage!==state.setupStage;
  }
  $('welcome-intro').hidden=state.setupStage!==1;$('how-it-works').hidden=true;$('selection-summary').hidden=state.setupStage===1;
  $('selection-text').textContent=state.topic;$('employee-role').hidden=state.setupStage!==1||!state.profile;
}
function resetProfile(){state.profile=state.catalog?.employeeProfile||null;state.scenario=null;state.scenarios=[];$('scenario-detail').hidden=true;stepper();}
async function loadScenarios(){
  if(!state.profile)return toast('Для вашей должности пока не настроен профиль оценки. Обратитесь к организатору.');
  state.scenario=null;$('scenario-detail').hidden=true;const topic=state.topic;
  try{const data=await api('scenarios?'+new URLSearchParams({topic,profile:state.profile.id}));if(state.topic!==topic)return;state.scenarios=data.scenarios;renderScenarios();setSetupStage(3);}
  catch(error){toast(error.message);}
}
function renderScenarios(){
  const box=$('scenario-list');box.replaceChildren();box.hidden=Boolean(state.scenario);$('change-scenario').hidden=!state.scenario;$('scenario-section').hidden=state.setupStage!==3;$('scenario-count').textContent=`Подходящих ситуаций: ${state.scenarios.length}`;
  for(const [index,s] of state.scenarios.entries()){const button=el('button','scenario-card');button.dataset.scenario=s.id;button.setAttribute('aria-pressed',String(state.scenario?.id===s.id));button.classList.toggle('selected',state.scenario?.id===s.id);button.append(el('span','id-label','Ситуация '+(index+1)),el('h3','',s.title),el('p','',s.brief));const bottom=el('div','scenario-bottom');bottom.append(el('span','','Выбрать ситуацию'),uiIcon('arrow'));button.append(bottom);button.addEventListener('click',()=>chooseScenario(s));box.append(button);}
  if(!state.scenarios.length)box.append(el('p','small-note','По этой теме нет сценария с компетенциями вашего профиля. Выберите другую тему; профиль автоматически не меняется.'));
}
function chooseScenario(s){state.scenario=s;renderScenarios();$('scenario-detail').hidden=false;$('detail-id').textContent='ВАША СИТУАЦИЯ';$('detail-role').textContent=state.catalog.employeePosition||state.profile.title;$('detail-character').textContent=s.character;$('detail-title').textContent=s.title;$('detail-brief').textContent=s.brief;const chips=$('detail-competencies');chips.replaceChildren();for(const c of s.competencies){const chip=el('span','chip',c.name);chip.append(el('strong','',`цель ${fmt(c.target)}`));chips.append(chip);}stepper();$('scenario-detail').scrollIntoView({behavior:'smooth',block:'start'});}
function acceptSession(session){state.session=session;sessionStorage.setItem('nt-current-session',session.id);updateBadge();$('show-result').disabled=!session.report;}
async function startSession(){
  if(state.busy)return;if(!state.topic||!state.profile||!state.scenario)return toast('Выберите тему и ситуацию');
  if(state.mode==='ai'&&!state.connection.configured){openSettings();return;}
  busy(true);try{const s=await api('sessions',{topic:state.topic,profileId:state.profile.id,scenarioId:state.scenario.id,mode:state.mode,difficulty:'начальный'});acceptSession(s);$('message-input').value='';state.pending=null;renderChat();showView('chat');if(!matchMedia('(max-width:680px)').matches)$('message-input').focus({preventScroll:true});}catch(error){toast(error.message);}finally{busy(false);}
}

function portrait(character,small=false){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');svg.classList.add(small?'portrait-small':'portrait');
  const seed=[...character].reduce((n,c)=>n+c.charCodeAt(0),0),variant=seed%3;
  const make=(tag,attrs)=>{const node=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,v);svg.append(node);return node;};
  const colors=[['#e6edef','#1b4154','#402f2d'],['#e7e7d7','#233135','#392c24'],['#e0e8eb','#1b4154','#514039']][variant];
  make('rect',{width:'100',height:'100',rx:'24',fill:colors[0]});
  if(variant===2)make('path',{d:'M24 57V35C24 5 76 7 76 36V64H24',fill:colors[2]});
  make('path',{d:'M10 100C12 64 88 64 90 100Z',fill:colors[1]});
  make('path',{d:'M41 59H59V74Q50 85 41 74Z',fill:'#dca98b'});
  make('ellipse',{cx:'50',cy:'42',rx:'22',ry:'27',fill:'#ebbea0'});
  make('path',{d:variant===1?'M28 42C18 14 46 5 65 15C78 20 77 36 72 41L65 28Q45 34 34 27Z':'M27 42C19 21 34 10 53 12C73 12 80 30 71 44L67 29Q45 22 32 37Z',fill:colors[2]});
  make('path',{d:'M37 44h5M58 44h5',stroke:'#3c3030','stroke-width':'2.5','stroke-linecap':'round'});
  make('path',{d:'M50 46l-2 9h5',fill:'none',stroke:'#c28a70','stroke-width':'1.5','stroke-linecap':'round'});
  make('path',{d:'M43 61Q50 65 57 60',fill:'none',stroke:'#915d52','stroke-width':'2','stroke-linecap':'round'});
  make('path',{d:'M36 77L46 88L50 80L55 88L64 77',fill:'#fff9ee'});
  return svg;
}
function renderPerson(character){
  const parts=character.split(',');$('person-name').textContent=parts[0].trim();$('person-role').textContent=parts.slice(1).join(',').trim()||'Ваш собеседник';
  $('person-avatar').replaceChildren(portrait(character));
}

function employeeName(){return state.employee?.fullName?.split(/\s+/).slice(0,2).join(' ')||'Вы';}
function employeeInitials(){return state.employee?.fullName?.split(/\s+/).slice(0,2).map(x=>x[0]).join('')||'Вы';}
function messageNode(message,index){const row=el('div','message-row '+(message.role==='user'?'user':['hint','notice'].includes(message.kind)?'hint':'character'));const content=el('div','message-content');content.append(el('div','message-label',message.role==='user'?employeeName():message.kind==='hint'?'Подсказка тренера':message.kind==='notice'?'Тренировка':state.session.scenario.character),el('div','message-text',message.text));row.append(message.role==='assistant'&&message.kind==='character'?portrait(state.session.scenario.character,true):el('span','avatar',message.role==='user'?employeeInitials():'✧'),content);return row;}
function scoreNode(step){const box=el('div','score-card');const heading=el('div','score-card-heading');heading.append(el('span','',`Оценка шага ${step.turn}`));const value=el('strong','',fmt(step.score));value.append(el('small','','/ 3'));heading.append(value);box.append(heading);for(const r of step.scores){const c=state.session.scenario.competencies.find(c=>c.id===r.id);const p=el('p','score-detail');p.append(el('strong','',`${c?.name||''} — ${fmt(r.score)} · цель ${fmt(c?.target)}`),document.createTextNode(' '+r.reason));box.append(p);}if(step.demo)box.append(el('div','demo-caption','Условная оценка демонстрации'));return box;}
function renderMessages(optimistic){const s=state.session,box=$('messages');box.replaceChildren();let turn=0;for(const [index,m] of s.history.entries()){box.append(messageNode(m,index));if(m.role==='user'){const step=s.steps[turn++];if(step)box.append(scoreNode(step));}}if(optimistic)box.append(messageNode({role:'user',text:optimistic}));if(state.busy)box.append(el('div','pending-message','Собеседник обдумывает ответ…'));}
function renderChat(){const s=state.session;$('chat-topic').textContent=s.scenario.topic;$('chat-title').textContent=s.scenario.title;$('chat-position').textContent=state.catalog.employeePosition||s.profile.title;$('chat-brief').textContent=s.scenario.brief;$('chat-role').textContent='Вы: '+s.profile.title+'. Собеседник: '+s.scenario.character;$('chat-guidance').textContent=s.steps.length?'':'Прочитайте реплику и ответьте своими словами.';$('chat-guidance').hidden=s.steps.length>0;renderPerson(s.scenario.character);$('chat-demo-note').hidden=s.mode!=='demo';const stages=$('dialogue-stages');stages.replaceChildren();const passed=new Set(s.steps.flatMap(x=>x.stageIds));for(const step of s.stages){const li=el('li',passed.has(step.stage)?'done':'');li.append(el('span','stage-number',passed.has(step.stage)?'✓':String(step.stage)),el('span','',step.goal));stages.append(li);}const comps=$('chat-competencies');comps.replaceChildren();for(const c of s.scenario.competencies){const item=el('div','competency-mini');item.append(el('span','',c.name));const p=el('small','','Цель должности ');p.append(el('strong','',fmt(c.target)));item.append(p);comps.append(item);}renderMessages();$('message-input').placeholder=s.paused?'Напишите «Продолжить», когда будете готовы…':'Ответьте собеседнику своими словами…';$('message-form').hidden=s.complete;$('chat-complete').hidden=!s.complete;$('finish-session').textContent=s.complete?'Получить разбор':'Завершить разговор';}
async function sendMessage(event){event.preventDefault();if(state.busy||!state.session)return;const message=$('message-input').value.trim();if(!message)return;if(/^(стоп|завершить|закончить)[.!]?$/i.test(message)){await finishSession();return;}const requestId=state.pending?.message===message?state.pending.requestId:crypto.randomUUID();state.pending={message,requestId};busy(true);renderMessages(message);try{const s=await api(`sessions/${state.session.id}/turn`,{message,requestId});acceptSession(s);$('message-input').value='';state.pending=null;renderChat();}catch(error){toast(error.message);renderMessages();}finally{busy(false);const pending=$('messages').querySelector('.pending-message');pending?.remove();if(!state.session.complete)$('message-input').focus();}$('message-form').scrollIntoView({behavior:'smooth',block:'end'});}
async function hint(){if(state.busy)return;busy(true);try{acceptSession(await api(`sessions/${state.session.id}/hint`,{}));renderChat();}catch(error){toast(error.message);}finally{busy(false);$('messages').querySelector('.pending-message')?.remove();}}
async function finishSession(){if(state.busy)return;busy(true);const b=$('finish-session'),previous=b.textContent;b.textContent='Составляю разбор…';try{acceptSession(await api(`sessions/${state.session.id}/finalize`,{}));renderResult();showView('result');}catch(error){toast(error.message);}finally{busy(false);b.textContent=previous;}}
function drawChart(){const data=state.session.steps.filter(s=>s.score!==null),box=$('score-chart');box.replaceChildren();if(!data.length)return;const ns='http://www.w3.org/2000/svg';const make=(tag,attrs)=>{const node=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;};const svg=make('svg',{viewBox:'0 0 500 68',class:'score-chart',role:'img','aria-label':'Оценки последовательных шагов'});for(const y of [8,33,58])svg.append(make('line',{x1:6,x2:494,y1:y,y2:y}));const points=data.map((s,i)=>({x:data.length===1?250:8+i*484/(data.length-1),y:58-s.score/3*50}));svg.append(make('path',{d:points.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' ')}));for(const p of points)svg.append(make('circle',{cx:p.x,cy:p.y,r:3.3}));box.append(svg,el('div','chart-caption','Оценки шагов · 0–3. Итог учитывает исправления и весь диалог.'));}
function renderResult(){
  const s=state.session,r=s.report;$('result-context').textContent=s.scenario.title+' · '+s.profile.title;$('result-demo-note').hidden=s.mode!=='demo';$('result-total').textContent=fmt(r.total);$('result-coverage').textContent=`Оценено ${r.coverage.observed} из ${r.coverage.profile} компетенций профиля`;$('outcome-label').textContent={achieved:'Договоренность достигнута',partial:'Часть вопросов еще открыта',not_achieved:'Нужна следующая попытка'}[r.outcome];$('result-summary-text').textContent=r.summary;drawChart();
  const box=$('result-competencies');box.replaceChildren();for(const c of r.scores){const card=el('article','competency-result');const heading=el('div','competency-result-heading');heading.append(el('h3','',c.name));const pair=el('div','score-pair');pair.append(el('strong','',fmt(c.score)),document.createTextNode('цель '+fmt(c.target)));heading.append(pair);card.append(heading,el('p','',c.reason));if(c.quote)card.append(el('blockquote','',c.quote));else card.append(el('p','small-note','Подтверждающая реплика отсутствует или данных недостаточно.'));const limits=el('details');limits.append(el('summary','','Что еще нужно проверить в работе'),el('p','',c.limits));card.append(limits);box.append(card);}
  $('unassessed-summary').textContent=`Не проверялось этим сценарием: ${r.unassessed.length} компетенций`;$('unassessed-list').replaceChildren(...r.unassessed.map(c=>el('li','',c.name+' · цель '+fmt(c.target))));$('strengths').replaceChildren(...(r.strengths.length?r.strengths.map(x=>el('p','',x.text)): [el('p','',(s.mode==='demo'?'Недостаточно подтверждений для отдельного вывода. В демо оценки условные.':'Недостаточно подтверждений для отдельного вывода.'))]));$('growth').textContent=r.growth;
  let saved=$('saved-reflection');if(!saved){saved=el('section','saved-reflection');saved.id='saved-reflection';$('reflection-section').before(saved);}saved.hidden=!s.plan||!s.reflection.some(Boolean);saved.replaceChildren(el('h2','','Ваша рефлексия'),...s.reflection.filter(Boolean).map(text=>el('p','',text)));
  $('reflection-section').hidden=Boolean(s.plan);$('monthly-section').hidden=!s.plan;$('jump-reflection').textContent=s.plan?'К заданию на месяц ↓':'Дальше: план практики ↓';if(s.plan)renderPlan();
}
const prettyDate=value=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'long'}).format(new Date(value+'T12:00:00Z'));
function renderPlan(){const p=state.session.plan;$('plan-dates').textContent=prettyDate(p.start)+' — '+prettyDate(p.end);$('plan-goal').textContent=p.goal;const box=$('plan-weeks');box.replaceChildren();for(const [i,w]of p.weeks.entries()){const card=el('article','week-card'),heading=el('div','week-number');heading.append(el('strong','',`Неделя ${i+1}`),el('span','',prettyDate(w.start)+' — '+prettyDate(w.end)));card.append(heading,el('h3','',w.action),el('div','week-proof','Подтверждение: '+w.proof));box.append(card);}$('plan-completion').textContent=p.completion;}
async function makePlan(event){event.preventDefault();if(state.busy)return;busy(true);$('make-plan').textContent='Составляю план…';try{acceptSession(await api(`sessions/${state.session.id}/plan`,{answers:[$('reflection-one').value.trim(),$('reflection-two').value.trim()]}));renderResult();$('monthly-section').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){toast(error.message);}finally{busy(false);$('make-plan').replaceChildren(document.createTextNode('Получить задание на месяц '),uiIcon('arrow'));}}
function download(){const s=state.session,r=s.report;let text=`# Результат Нейротренера\n\n${s.scenario.title}\nДолжность: ${s.profile.title}\nРежим: ${s.mode==='demo'?'ДЕМО, оценки условные':'ИИ'}\nИтог эпизода: ${fmt(r.total)} / 3\nПокрытие: ${r.coverage.observed} из ${r.coverage.profile}\n\n${r.summary}\n\n`;for(const c of r.scores)text+=`## ${c.name}\n\nОценка эпизода: ${fmt(c.score)}. Цель должности: ${fmt(c.target)}.\n${c.reason}\n${c.quote?'Цитата: «'+c.quote+'»':''}\nГраница наблюдения: ${c.limits}\n\n`;text+='## Фокус практики\n\n'+r.growth+'\n\n';if(s.reflection.some(Boolean))text+='## Ваша рефлексия\n\n'+s.reflection.filter(Boolean).join('\n\n')+'\n\n';if(s.plan){text+=`## Практика ${s.plan.start} — ${s.plan.end}\n\n${s.plan.goal}\n\n`;for(const [i,w]of s.plan.weeks.entries())text+=`### Неделя ${i+1} · ${w.start} — ${w.end}\n\n${w.action}\nПодтверждение: ${w.proof}\n\n`;text+='Проверка: '+s.plan.completion+'\n';}const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=el('a');a.href=url;a.download=`Нейротренер_${s.scenario.id}_${s.date}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function openSettings(){const c=state.connection;$('api-base').value=c?.base||'https://api.openai.com/v1';$('api-model').value=c?.model||'gpt-4.1-mini';$('api-style').value=c?.style||'responses';$('api-key').value='';$('key-status').textContent=c?.configured?'Ключ уже задан на сервере. Пустое поле сохранит текущий ключ.':'Ключ еще не задан.';$('connection-result').textContent='';$('settings-dialog').showModal();if(state.hosted){for(const id of ['api-base','api-model','api-style','api-key'])$(id).disabled=true;$('save-settings').hidden=true;$('test-connection').hidden=true;$('api-key').hidden=true;$('key-status').textContent=state.connection.configured?'Модель подключена администратором.':'Модель пока не подключена. Доступно демо.';$('settings-dialog').querySelector('.dialog-heading+p').textContent='Ключ и модель настраивает администратор в Render.';}}
async function saveSettings({close=false}={}){const data=await api('settings',{base:$('api-base').value.trim(),model:$('api-model').value.trim(),style:$('api-style').value,key:$('api-key').value});state.connection=data;$('api-key').value='';$('key-status').textContent=data.configured?'Ключ задан на сервере.':'';if(data.configured&&!state.session)setRunMode('ai');updateBadge();if(close)$('settings-dialog').close();return data;}
function newTraining(){if(state.busy)return toast('Дождитесь завершения запроса');state.setupStage=1;state.topic='';resetProfile();document.querySelectorAll('[data-topic]').forEach(b=>b.setAttribute('aria-pressed','false'));state.session=null;sessionStorage.removeItem('nt-current-session');$('show-result').disabled=true;showView('setup');updateBadge();}
document.querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',async()=>{if(state.busy)return;state.topic=button.dataset.topic;document.querySelectorAll('[data-topic]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));resetProfile();await loadScenarios();}));
$('mode-demo').addEventListener('click',()=>setRunMode('demo'));$('mode-ai').addEventListener('click',()=>setRunMode('ai'));$('start-session').addEventListener('click',startSession);$('message-form').addEventListener('submit',sendMessage);$('message-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('message-form').requestSubmit();}});$('hint-button').addEventListener('click',hint);$('finish-session').addEventListener('click',finishSession);$('reflection-form').addEventListener('submit',makePlan);$('download-result').addEventListener('click',download);$('new-training').addEventListener('click',newTraining);$('another-session').addEventListener('click',newTraining);$('show-result').addEventListener('click',()=>{if(state.session?.report){renderResult();showView('result');}});$('retry-session').addEventListener('click',async()=>{const old=state.session;newTraining();state.topic=old.scenario.topic;state.profile=state.catalog.profiles.find(p=>p.id===old.profile.id);state.scenario=old.scenario;state.mode=old.mode;await startSession();});
$('settings-open').addEventListener('click',openSettings);$('settings-close').addEventListener('click',()=>$('settings-dialog').close());$('settings-form').addEventListener('submit',async event=>{event.preventDefault();$('save-settings').disabled=true;try{await saveSettings({close:true});toast('Подключение сохранено для новых тренировок');}catch(error){toast(error.message);}finally{$('save-settings').disabled=false;}});$('test-connection').addEventListener('click',async()=>{const b=$('test-connection');b.disabled=true;$('connection-result').classList.remove('error');$('connection-result').textContent='Проверяю соединение…';try{await saveSettings();await api('connection',{});$('connection-result').textContent='Соединение установлено. Можно начать тренировку с ИИ.';}catch(error){$('connection-result').classList.add('error');$('connection-result').textContent=error.message;}finally{b.disabled=false;}});
async function init(){try{const access=await api('auth/status');state.csrf=access.csrf;state.employee=access.employee;$('access-loading').hidden=true;document.body.classList.remove('auth-checking');if(access.required&&!access.employee){showLogin(access.configured?'':'Список сотрудников еще не загружен. Организатору нужно настроить доступ.');$('login-submit').disabled=!access.configured;return;}$('login-view').hidden=true;document.body.classList.remove('auth-locked');$('employee-account').hidden=!access.employee;$('signed-in-name').textContent=employeeName();$('employee-top-name').textContent=employeeName();state.catalog=await api('bootstrap');state.profile=state.catalog.employeeProfile||null;$('employee-role').textContent=state.profile?'Ваша должность: '+(state.catalog.employeePosition||state.profile.title)+(state.catalog.profileMatch&&state.catalog.profileMatch!=='exact'?' · Профиль оценки: '+state.profile.title:''):'';$('employee-role').hidden=!state.profile;if(!state.profile)toast('Для вашей должности пока не настроен профиль оценки. Обратитесь к организатору.');state.csrf=state.catalog.csrf;state.connection=state.catalog.connection;state.hosted=Boolean(state.catalog.hosting?.managed);setRunMode(state.connection.configured?'ai':'demo');const saved=sessionStorage.getItem('nt-current-session');if(saved){try{const s=await api('sessions/'+saved);acceptSession(s);if(s.report){renderResult();showView('result');}else{renderChat();showView('chat');}}catch{sessionStorage.removeItem('nt-current-session');}}}catch(error){$('access-loading').hidden=true;document.body.classList.remove('auth-checking');showLogin(error.message);toast(location.protocol==='file:'?'Откройте «Запустить Нейротренер.cmd», затем http://127.0.0.1:8765. Для работы с ИИ нужен локальный сервер.':error.message);}}
$('change-scenario').addEventListener('click',()=>{state.scenario=null;$('scenario-detail').hidden=true;renderScenarios();setSetupStage(3);});
$('review-complete').addEventListener('click',finishSession);
$('goto-topic').addEventListener('click',()=>setSetupStage(1));
$('goto-scenario').addEventListener('click',()=>setSetupStage(3));
$('setup-back').addEventListener('click',()=>setSetupStage(1));
$('jump-reflection').addEventListener('click',()=>{const section=$(state.session.plan?'monthly-section':'reflection-section');section.scrollIntoView({behavior:'smooth',block:'start'});if(!state.session.plan)$('reflection-one').focus({preventScroll:true});});

function showLogin(message=''){
  document.body.classList.add('auth-locked');document.body.classList.remove('auth-checking');
  $('access-loading').hidden=true;$('login-view').hidden=false;$('login-message').textContent=message;
}
let waitingForCode=false,resendTimer;
function codeScreen(active){
  waitingForCode=active;$('login-code-fields').hidden=!active;$('login-full-name').readOnly=active;
  $('login-code').required=active;$('login-code').value='';$('login-submit').textContent=active?'Войти в тренажер →':'Получить код в Битрикс24 →';
  $('login-submit').replaceChildren(document.createTextNode(active?'Войти в тренажер':'Получить код в Битрикс24'),uiIcon('arrow'));renderCodeDigits(false);$('otp-entry').classList.remove('invalid','verifying','accepted');
  document.querySelectorAll('[data-login-step]').forEach(node=>{if(node.dataset.loginStep===(active?'code':'name'))node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});if(active)$('login-code').focus();else{clearInterval(resendTimer);$('login-full-name').focus();}
}
function resendCountdown(seconds=60){
  clearInterval(resendTimer);const button=$('login-resend');let left=seconds;
  const render=()=>{button.disabled=left>0;button.textContent=left>0?`Отправить снова через ${left} с`:'Отправить код снова';};
  render();resendTimer=setInterval(()=>{left--;render();if(left<=0)clearInterval(resendTimer);},1000);
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('login-submit');button.disabled=true;$('login-message').classList.remove('error');$('login-message').textContent=waitingForCode?'Проверяем код…':'Проверяем ФИО…';
  $('otp-entry').classList.remove('invalid');$('otp-entry').classList.toggle('verifying',waitingForCode);
  try{const result=await api(waitingForCode?'auth/verify':'auth/login',waitingForCode?{code:$('login-code').value.trim()}:{fullName:$('login-full-name').value.trim()});if(result.verificationRequired){codeScreen(true);resendCountdown(result.resendAfter);$('login-message').textContent=result.message;return;}if(waitingForCode){$('otp-entry').classList.remove('verifying');$('otp-entry').classList.add('accepted');if(!matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,180));}state.csrf=result.csrf;sessionStorage.removeItem('nt-current-session');state.session=null;$('login-full-name').value='';codeScreen(false);await init();}
  catch(error){$('login-message').classList.add('error');$('login-message').textContent=error.message;if(waitingForCode)$('otp-entry').classList.add('invalid');}
  finally{button.disabled=false;$('otp-entry').classList.remove('verifying');}
});

function cleanCode(value){return value.normalize('NFKC').replace(/[^0-9]/g,'').slice(0,6);}
function renderCodeDigits(animate=true){
  const input=$('login-code'),value=cleanCode(input.value);if(value!==input.value)input.value=value;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  for(const [i,cell]of [...$('otp-cells').children].entries()){
    const digit=value[i]||'',changed=cell.textContent!==digit;
    cell.classList.toggle('filled',Boolean(digit));cell.classList.toggle('active',i===Math.min(input.selectionStart??value.length,5));
    if(changed){cell.replaceChildren();if(digit){const node=el('span','otp-digit',digit);cell.append(node);if(animate&&!reduced)node.animate([{transform:'translateY(22px) scale(.85)',opacity:0,filter:'blur(4px)'},{transform:'translateY(-3px) scale(1.03)',opacity:1,filter:'blur(0)'},{transform:'translateY(0) scale(1)',opacity:1}],{duration:340,easing:'cubic-bezier(.2,.75,.25,1)'});}}
  }
}
$('login-code').addEventListener('input',()=>{$('otp-entry').classList.remove('invalid');renderCodeDigits();});
for(const event of ['click','keyup','focus'])$('login-code').addEventListener(event,()=>renderCodeDigits(false));
$('login-code').addEventListener('paste',event=>{const text=event.clipboardData?.getData('text');if(text===undefined)return;event.preventDefault();$('login-code').value=cleanCode(text);$('login-code').setSelectionRange($('login-code').value.length,$('login-code').value.length);$('otp-entry').classList.remove('invalid');renderCodeDigits();});
$('login-change-name').addEventListener('click',()=>{codeScreen(false);$('login-message').textContent='Введите ФИО из списка сотрудников.';});
$('login-resend').addEventListener('click',async()=>{
  $('login-resend').disabled=true;
  try{const result=await api('auth/login',{fullName:$('login-full-name').value.trim()});$('login-message').textContent=result.message;$('login-code').value='';renderCodeDigits(false);$('otp-entry').classList.remove('invalid');resendCountdown(result.resendAfter);}
  catch(error){$('login-message').textContent=error.message;$('login-resend').disabled=false;}
});
$('sign-out').addEventListener('click',async()=>{
  if(state.busy)return toast('Дождитесь завершения ответа');
  try{await api('auth/logout',{});sessionStorage.removeItem('nt-current-session');state.session=null;state.employee=null;await init();}
  catch(error){toast(error.message);}
});

decorateInterface();
renderCodeDigits(false);
stepper();
await init();
