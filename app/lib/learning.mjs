import {halfMean,validateScores} from './domain.mjs';

export const assessmentRules=`Оцени два независимых слоя: learning — пять учебных критериев текущего задания, scores — только активные компетенции должностной матрицы. Не подменяй качество SMART честностью, обратную связь только доверием, а делегирование обязательным развитием человека. Основной учебный результат относится к заданию, а не к общему уровню личности. Оценивай действия user, не готовый план assistant. Использование запрошенных фактов не является подсказкой решения. Если user только повторил содержательное решение, уже предложенное assistant, source=prompted и соответствующий балл не выше 1; обоснуй степень помощи. source=unobserved и score=null при отсутствии возможности наблюдения; source=independent для собственных действий. На первых уточнениях не требуй весь финал; незавершенный критерий не равен автоматически нулю. В финале учитывай исправления, но не стирай незакрытые противоречия. Для исследования оцени постановку исследования, а не еще не полученное коммерческое решение. В learning цитата — дословный фрагмент user из enum, а не скрытой карточки или слов модели. При prompted источник помощи опиши в reason. Не требуй выученного пароля или точного совпадения с образцом; принимай содержательно равнозначные выполнимые решения.`;

export function validateLearning(rows,scenario,messages,{all=false}={}){
  if(rows===undefined)return null; // Existing stored reports/test providers can predate revision 3.
  validateScores(rows,scenario.learning_rubric||[],messages,all);
  const scores=rows.map(row=>{
    if(!['independent','prompted','unobserved'].includes(row.source))throw new Error('Не указан источник учебного действия');
    if(row.source==='unobserved'&&row.score!==null)throw new Error('Ненаблюдаемый учебный критерий не получает балл');
    const c=scenario.learning_rubric.find(c=>c.id===row.id),capped=row.source==='prompted'&&row.score>1;
    const displayName=all?c.name:scenario.dialogue_flow.find(f=>f.stage===Number(c.id.slice(1)))?.public_goal||c.name;
    return {...row,name:displayName,score:capped?1:row.score,reason:capped?row.reason+' Балл ограничен 1: решение выполнено с прямой помощью.':row.reason};
  });
  return {version:3,topic:scenario.topic,scores,total:halfMean(scores.map(r=>r.score)),observed:scores.filter(r=>r.score!==null).length,count:scenario.learning_rubric.length,prompted:scores.filter(r=>r.source==='prompted').length};
}

export function contractProgress(session,actor,messages,lastMessage){
  const requirements=session.context.scenario.training_contract?.requirements||[];
  if(!requirements.length)return {conditions:[],complete:actor.complete,warmup:session.warmup};
  const supplied=actor.conditions;
  const conditions=requirements.map(c=>({id:c.id,state:'open',quote:''}));
  if(supplied!==undefined){
    if(!Array.isArray(supplied)||supplied.length!==requirements.length||new Set(supplied.map(c=>c.id)).size!==requirements.length)throw new Error('Не все условия разговора проверены');
    for(const row of supplied){
      const target=conditions.find(c=>c.id===row.id);
      if(!target||!['open','confirmed'].includes(row.state)||typeof row.quote!=='string')throw new Error('Некорректное состояние договоренности');
      if(row.quote&&!messages.some(m=>m.includes(row.quote)))throw new Error('Условие не подтверждено репликой участника');
      // A bare assent cannot establish five substantive requirements.
      if(row.state==='confirmed'&&(!row.quote||(row.quote.match(/[\p{L}\p{N}]+/gu)||[]).length<3))continue;
      Object.assign(target,row);
    }
  }
  let complete=conditions.every(c=>c.state==='confirmed'),warmup=session.warmup;
  if(warmup){
    warmup={index:warmup.index,items:[...warmup.items]};
    const decision=actor.itemDecision;
    if(decision&&decision.item!==warmup.index+1)throw new Error('Тренер попытался переключить текущее задание');
    const skip=/^пропустить(?:\s+(?:это\s+)?задание)?[.!]?$/iu.test(lastMessage.trim());
    const accepted=complete&&decision?.verdict==='accepted';
    if(accepted||skip){warmup.items[warmup.index]=skip?'skipped':'accepted';warmup.index++;}
    complete=warmup.index>=5;
  }
  if(session.context.scenario.id==='TM03'&&session.difficulty==='сложный'&&session.steps.length<3)complete=false;
  return {conditions,complete,warmup};
}

export function outcomeFor(session,proposed){
  if(!session.context.scenario.training_contract)return proposed;
  if(proposed==='achieved'&&session.context.scenario.id==='TM03'&&session.difficulty==='сложный'&&session.steps.length<4)return 'partial';
  const full=session.warmup?session.warmup.index>=5&&session.warmup.items.every(v=>v==='accepted'):session.conditions?.length===5&&session.conditions.every(c=>c.state==='confirmed');
  if(proposed==='achieved'&&!full)return 'partial';
  return proposed;
}
