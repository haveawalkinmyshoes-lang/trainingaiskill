// Training records and administrative views use server data only.
export function createWorkspaceUI({api,state,el,showView,newTraining,toast}) {
  const $=id=>document.getElementById(id);
  const routes={history:'history',leaderboard:'rating',analytics:'admin'};
  const titles={history:'Моя история',leaderboard:'Рейтинг практики',analytics:'Аналитика обучения'};
  const topics=['SMART','Обратная связь','Управление временем'];
  const paths={history:'M3 12a9 9 0 1 0 3-6M3 3v6h6M12 7v5l3 2',trophy:'M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v7m-4 0h8',chart:'M4 3v17h17M8 15v-4m5 4V7m5 8v-6',collapse:'M9 4v16m8-14-6 6 6 6',plus:'M12 5v14M5 12h14',report:'M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h3',comment:'M4 4h16v12H9l-5 4V4Z'};
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.report);svg.append(path);return svg;}
  document.querySelectorAll('[data-workspace-icon]').forEach(n=>n.replaceChildren(icon(n.dataset.workspaceIcon)));
  $('new-training').querySelector('.nav-icon').replaceChildren(icon('plus'));
  $('show-result').querySelector('.nav-icon').replaceChildren(icon('report'));
  let requestedRoute=location.hash;
  let collapsed=false;try{collapsed=localStorage.getItem('nt-sidebar-collapsed')==='true';}catch{}
  function collapse(){document.body.classList.toggle('sidebar-collapsed',collapsed);$('sidebar-toggle').setAttribute('aria-expanded',String(!collapsed));$('sidebar-toggle').title=collapsed?'Развернуть меню':'Свернуть меню';$('sidebar-toggle').setAttribute('aria-label',$('sidebar-toggle').title);}
  collapse();$('sidebar-toggle').onclick=()=>{collapsed=!collapsed;collapse();try{localStorage.setItem('nt-sidebar-collapsed',String(collapsed));}catch{}};
  const panels={},filters={},contents={};let active='',serial=0;
  const button=(text,action,style='secondary-button')=>{const node=el('button',style,text);node.type='button';node.onclick=action;return node;};
  const date=value=>value?new Date(value).toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'}):'—';
  const number=value=>typeof value==='number'?value.toLocaleString('ru-RU',{maximumFractionDigits:2}):'—';
  const storageNote=()=>el('p','storage-note','Пилот: история, рейтинг и отзывы сохраняются до перезапуска сервера. Постоянное хранилище пока не подключено.');
  function empty(title,text,cta=false){const box=el('div','ws-empty');box.append(el('h2','',title),el('p','',text));if(cta)box.append(button('Выбрать тренировку',newTraining,'primary-button'));return box;}
  function table(headings,rows){const wrap=el('div','ws-table-wrap'),table=el('table','ws-table'),head=el('thead'),tr=el('tr');for(const text of headings){const th=el('th','',text);th.scope='col';tr.append(th);}head.append(tr);table.append(head);const body=el('tbody');for(const cells of rows){const row=el('tr');for(const value of cells){const td=el('td');td.append(value instanceof Node?value:document.createTextNode(String(value??'—')));row.append(td);}body.append(row);}table.append(body);wrap.append(table);return wrap;}
  function section(title,...nodes){const box=el('section','ws-panel');box.append(el('h2','',title),...nodes);return box;}
  function select(label,options){const box=el('label','ws-filter',label),input=el('select');for(const [value,text]of options){const option=el('option','',text);option.value=value;input.append(option);}box.append(input);return {box,input};}
  for(const name of Object.keys(routes)){
    const panel=el('section','view workspace-view');panel.id=name+'-view';panel.hidden=true;
    const heading=el('div','ws-heading'),copy=el('div');copy.append(el('div','eyebrow',name==='analytics'?'ДЛЯ ОРГАНИЗАТОРА':'ВАША ПРАКТИКА'),el('h1','',titles[name]));heading.append(copy,button('Обновить',()=>load(name)));
    const controls=el('div','ws-filters');const period=select('Период',[['30','30 дней'],['7','7 дней'],['90','90 дней'],['all','Все время']]),topic=select('Тема',[['','Все темы'],...topics.map(t=>[t,t])]);
    controls.append(period.box,topic.box);period.input.onchange=topic.input.onchange=()=>load(name);
    const content=el('div','ws-content');content.setAttribute('aria-live','polite');
    panel.append(heading,storageNote(),controls,content);$('setup-view').parentNode.append(panel);
    panels[name]=panel;filters[name]={period:period.input,topic:topic.input,controls};contents[name]=content;
    $('nav-'+name).onclick=()=>{if(state.busy)return toast('Дождитесь завершения запроса');showView(name);};
  }
  function query(name){return new URLSearchParams({period:filters[name].period.value,topic:filters[name].topic.value}).toString();}
  function renderHistory(data,box){
    if(!data.items.length){box.append(empty('История начинается с разговора','Здесь появятся ваши попытки, разборы и планы практики.',true));return;}
    box.append(el('p','ws-caption','Ваши попытки в обоих режимах. Оценки режима «По сценарию» условные.'));
    box.append(table(['Когда','Упражнение','Режим','Этап','Оценка эпизода'],data.items.map(r=>[date(r.startedAt),button(r.title,()=>openRecord(r),'ws-link'),r.mode==='ai'?'С ИИ':'По сценарию',r.planAt?'План готов':r.reportAt?'Разбор готов':'Без разбора',r.reportAt?number(r.total)+' / 3':'—'])));
  }
  function renderLeaderboard(data,box){
    box.append(el('p','ws-caption','Первая десятка по числу разных упражнений с разбором ИИ. При равенстве выше тот, кто практиковался в большее число дней. Средняя оценка показана отдельно: профили должностей различаются.'));
    if(!data.items.length){box.append(empty('Пока нет завершенных тренировок с ИИ','Пройдите упражнение и получите разбор — результат появится здесь. Режим «По сценарию» в рейтинг не входит.',true));return;}
    box.append(el('p','ws-count',`Участников: ${data.totalParticipants}`));
    box.append(table(['Место','Участник','Разных упражнений','Дней практики','Средний балл / 3','Планов'],data.items.map(r=>{const name=el('span',r.isYou?'ws-you':'',r.name+(r.isYou?' · вы':''));const place=el('span','ws-place'+(r.place<=3?' medal':''),String(r.place));return [place,name,r.completed,r.days,number(r.average),r.plans];})));
    if(data.you&&!data.items.some(r=>r.isYou))box.append(el('p','ws-own-rank',`Ваше место: ${data.you.place}. Разных упражнений: ${data.you.completed}. Дней практики: ${data.you.days}.`));
  }
  function renderGate(box,message=''){
    filters.analytics.controls.hidden=true;
    const form=el('form','ws-admin-gate'),label=el('label','','Код администратора'),input=el('input');input.id='analytics-code';input.type='password';input.required=true;input.autocomplete='off';input.maxLength=200;label.htmlFor=input.id;
    const error=el('p','ws-error',message);error.setAttribute('role','status');const submit=el('button','primary-button','Открыть аналитику');submit.type='submit';
    form.append(el('h2','','Вход для организатора'),el('p','','Для просмотра результатов коллег нужен отдельный код администратора.'),label,input,error,submit);
    form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{await api('admin/login',{code:input.value});input.value='';await load('analytics');}catch(e){error.textContent=e.message;}finally{submit.disabled=false;}};
    box.append(form);
  }
  function renderAnalytics(data,box){
    filters.analytics.controls.hidden=false;const t=data.totals,stats=el('div','ws-stats');
    for(const [label,value,note]of [['Участников',t.participants,'Начали упражнение'],['Начато',t.started,`${t.ai} с ИИ · ${t.demo} по сценарию`],['Получили разбор',t.reported,'Завершенные попытки'],['Составили план',t.planned,'Практика на месяц'],['Полезность',number(t.usefulness),'От 1 до 5, по отзывам'],['Отзывов',t.reviewCount,'От участников']]){const card=el('article','ws-stat');card.append(el('span','',label),el('strong','',String(value)),el('small','',note));stats.append(card);}box.append(stats);
    box.append(el('p','ws-caption','Количество попыток за выбранный период, включая режим «По сценарию». Переходы в воронке считаются по созданным разборам и планам; просмотры страниц пока не отслеживаются.'));
    const funnel=el('div','ws-funnel');for(const [label,count]of [['Начали',t.started],['Получили разбор',t.reported],['Создали план',t.planned]]){const row=el('div','ws-funnel-row'),meter=el('progress');meter.max=Math.max(t.started,1);meter.value=count;meter.setAttribute('aria-label',label);row.append(el('span','',label),meter,el('strong','',`${count} · ${t.started?Math.round(count/t.started*100):0}%`));funnel.append(row);}box.append(section('Как проходят тренировку',funnel));
    const chart=el('div','ws-chart'),max=Math.max(1,...data.daily.map(d=>d.started));for(const d of data.daily){const cell=el('div','ws-chart-day'),bars=el('div','ws-bars');for(const [kind,count]of [['started',d.started],['reported',d.reported]]){const bar=el('span','ws-bar '+kind);bar.style.height=`${Math.max(2,count/max*100)}%`;bar.title=`${d.date}: ${kind==='started'?'начато':'с разбором'} ${count}`;bars.append(bar);}cell.append(bars,el('small','',d.date.slice(8)));chart.append(cell);}chart.setAttribute('aria-label','Начатые попытки и попытки с разбором по дате начала, за последние 14 дней');box.append(section('Последние 14 дней',el('p','ws-caption','Синий — начато, желтый — получен разбор. День указан по Москве.'),chart));
    if(data.topics.length)box.append(section('По темам',table(['Тема','Начато','Разборов','Планов'],data.topics.map(r=>[r.name,r.started,r.reported,r.planned]))));
    if(data.scenarios.length)box.append(section('Упражнения',table(['Упражнение','Начато','Разборов','Планов','Полезность / 5'],data.scenarios.map(r=>[r.title,r.started,r.reported,r.planned,number(r.usefulness)]))));
    const reviews=el('div','ws-reviews');for(const r of data.reviews){const card=el('article','ws-review');card.append(el('div','ws-review-meta',`${r.name} · ${date(r.at)} · ${r.category} · ${r.rating}/5`),el('h3','',r.title),el('p','',r.text||'Без комментария'));reviews.append(card);}box.append(section('Отзывы к упражнениям',reviews.childElementCount?reviews:el('p','ws-caption','Отзывов за этот период пока нет.')));
    if(data.recent.length)box.append(section('Последние попытки',table(['Когда','Участник','Упражнение','Режим','Реплик','Этап'],data.recent.map(r=>[date(r.startedAt),r.name,r.title,r.mode==='ai'?'С ИИ':'По сценарию',r.turns,r.status]))));
  }
  async function load(name){
    if(active!==name||!state.catalog||document.body.classList.contains('auth-locked'))return;
    const version=++serial,box=contents[name];box.replaceChildren(el('p','ws-caption','Загружаем…'));
    try{const data=await api((name==='history'?'history':name==='leaderboard'?'leaderboard':'analytics')+'?'+query(name));if(version!==serial||active!==name)return;box.replaceChildren();({history:renderHistory,leaderboard:renderLeaderboard,analytics:renderAnalytics})[name](data,box);}
    catch(error){if(version!==serial||active!==name)return;box.replaceChildren();if(name==='analytics'&&error.message.includes('код администратора'))renderGate(box);else box.append(empty('Не удалось загрузить',error.message),button('Повторить',()=>load(name)));}
  }
  const recordDialog=el('dialog','ws-record-dialog');recordDialog.id='history-record-dialog';document.body.append(recordDialog);
  function openRecord(r){
    recordDialog.replaceChildren(button('Закрыть',()=>recordDialog.close(),'ws-dialog-close'),el('div','eyebrow',date(r.startedAt)),el('h2','',r.title),el('p','ws-caption',r.mode==='ai'?'Тренировка с ИИ':'По сценарию · оценки условные'));
    if(!r.reportAt)recordDialog.append(el('p','','Разбор этой попытки не создан.'));
    else {recordDialog.append(el('p','ws-record-score',`${number(r.total)} / 3`),el('p','',r.summary),table(['Компетенция','Оценка / 3','Цель должности'],r.scores.map(s=>[s.name,number(s.score),number(s.target)])),el('h3','','Фокус практики'),el('p','',r.growth));}
    if(r.plan){recordDialog.append(el('h3','','План на месяц'),el('p','',r.plan.goal));for(const [i,w]of r.plan.weeks.entries())recordDialog.append(el('h4','',`Неделя ${i+1}`),el('p','',w.action),el('p','ws-caption',w.proof));recordDialog.append(el('p','',r.plan.completion));}
    recordDialog.showModal();
  }
  const feedbackDialog=el('dialog');feedbackDialog.id='feedback-dialog';document.body.append(feedbackDialog);let feedbackVersion=0;
  async function openFeedback(scenario){
    if(!scenario?.id)return;const version=++feedbackVersion;
    const form=el('form'),heading=el('div','dialog-heading'),close=button('×',()=>feedbackDialog.close(),'close-button');close.setAttribute('aria-label','Закрыть отзыв');heading.append(el('h2','','Отзыв об упражнении'),close);
    const usefulness=select('Насколько полезно упражнение?',[['','Выберите оценку'],['1','1 — совсем не полезно'],['2','2'],['3','3'],['4','4'],['5','5 — очень полезно']]);usefulness.input.required=true;
    const category=select('Тип отзыва',['Впечатление','Ошибка','Непонятное условие','Предложение'].map(t=>[t,t]));
    const label=el('label','','Комментарий'),text=el('textarea');text.rows=4;text.maxLength=2000;text.id='feedback-text';label.htmlFor=text.id;
    const error=el('p','ws-error');error.setAttribute('role','status');const save=el('button','primary-button','Сохранить отзыв');save.type='submit';save.disabled=true;
    form.append(heading,el('p','',scenario.title),el('p','ws-caption','Отзыв увидит организатор. Это оценка полезности упражнения, отдельно от оценки навыка.'),usefulness.box,category.box,label,text,storageNote(),error,save);feedbackDialog.replaceChildren(form);feedbackDialog.showModal();
    try{const data=await api('feedback?scenario='+encodeURIComponent(scenario.id));if(version!==feedbackVersion)return;if(data.review){usefulness.input.value=data.review.rating;category.input.value=data.review.category;text.value=data.review.text;}save.disabled=false;}catch(e){error.textContent=e.message;}
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await api('feedback',{scenarioId:scenario.id,rating:Number(usefulness.input.value),category:category.input.value,text:text.value});feedbackDialog.close();toast('Отзыв сохранен');}catch(e){error.textContent=e.message;}finally{save.disabled=false;}};
  }
  const feedbackButton=button('Оставить отзыв об упражнении',()=>openFeedback(state.scenario),'text-button');feedbackButton.id='exercise-feedback';$('scenario-detail').append(feedbackButton);
  const resultFeedback=button('Оставить отзыв',()=>openFeedback(state.session?.scenario));resultFeedback.id='result-feedback';document.querySelector('.result-heading-actions').append(resultFeedback);
  function fromHash(){if(!state.catalog||document.body.classList.contains('auth-locked'))return;const name=Object.keys(routes).find(n=>location.hash==='#/'+routes[n]);if(name&&active!==name)showView(name);}
  window.addEventListener('hashchange',fromHash);
  return {activate(name){active=name;++serial;if(routes[name]){history.replaceState(null,'','#/'+routes[name]);load(name);}else if(location.hash)history.replaceState(null,'',location.pathname+location.search);},ready(){const hash=requestedRoute||location.hash,name=Object.keys(routes).find(n=>hash==='#/'+routes[n]);requestedRoute='';if(name)showView(name);else if(!state.session)showView('setup');},lock(){++serial;active='';for(const box of Object.values(contents))box.replaceChildren();recordDialog.close();feedbackDialog.close();}};
}
