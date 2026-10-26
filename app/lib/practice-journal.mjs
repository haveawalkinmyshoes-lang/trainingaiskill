import {createHmac,timingSafeEqual,createHash,randomBytes} from 'node:crypto';
const fail=(text,status=400)=>Object.assign(new Error(text),{status});
const mean=values=>{const list=values.filter(v=>typeof v==='number');return list.length?Math.round(list.reduce((a,b)=>a+b,0)/list.length*100)/100:null;};
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'});
const localDay=value=>dayFormatter.format(value);
export const analyticsCode=secret=>createHmac('sha256',secret).update('neurotrainer:analytics-ui:v1').digest('hex').slice(0,32);
const label=name=>{const words=name.trim().split(/\s+/);return words.length>1?words[0]+' '+words[1][0]+'.':words[0];};
export class PracticeJournal{
  constructor({secret='',now=Date.now,local=false}={}){
    this.secret=secret||randomBytes(32).toString('hex');this.now=now;this.local=local;
    this.adminCode=secret.length>=32?analyticsCode(secret):null;
    this.startedAt=now();this.records=new Map();this.reviews=new Map();this.admins=new Map();this.adminAttempts={count:0,until:0};
  }
  storage(){return {kind:'memory',persistent:false,since:new Date(this.startedAt).toISOString()};}
  person(employee,owner){const name=employee?.fullName||'Участник';return {id:createHmac('sha256',this.secret).update(employee?.fullName?name.normalize('NFKC').toLowerCase():owner).digest('hex').slice(0,32),name:label(name)};}
  authorized(owner){if(this.local)return true;const expires=this.admins.get(owner);if(expires&&expires>this.now())return true;this.admins.delete(owner);return false;}
  loginAdmin(owner,code){
    if(!this.adminCode)throw fail('Доступ к аналитике пока не настроен',503);
    if(this.now()>=this.adminAttempts.until)this.adminAttempts={count:0,until:this.now()+600000};
    if(++this.adminAttempts.count>20)throw fail('Слишком много попыток. Повторите через 10 минут.',429);
    if(typeof code!=='string'||code.length>200||!timingSafeEqual(createHash('sha256').update(code.trim()).digest(),createHash('sha256').update(this.adminCode).digest()))throw fail('Код администратора не подошел',403);
    for(const [key,expiry]of this.admins)if(expiry<=this.now())this.admins.delete(key);
    if(this.admins.size>=100)throw fail('Слишком много административных подключений',429);
    this.admins.set(owner,this.now()+8*3600000);return {authorized:true};
  }
  logout(owner){this.admins.delete(owner);}
  capture(s){
    let item=this.records.get(s.id);
    if(!item){
      if(this.records.size>=5000){const oldest=[...this.records.keys()][0];this.records.delete(oldest);}
      const person=this.person(s.employee,s.owner),scenario=s.context.scenario,profile=s.context.profile;
      item={id:s.id,person,scenarioId:scenario.id,title:scenario.title,topic:scenario.topic,profileId:profile.id,position:s.employee?.position||profile.title,mode:s.mode,startedAt:s.createdAt,reportAt:null,planAt:null,turns:0,total:null,scores:[],summary:'',growth:'',plan:null};
    }
    item.turns=s.steps.length;
    if(s.report){item.reportAt??=this.now();item.total=s.report.total;item.summary=s.report.summary;item.growth=s.report.growth;item.scores=s.report.scores.map(({id,name,score,target})=>({id,name,score,target}));}
    if(s.plan){item.planAt??=this.now();item.plan=structuredClone(s.plan);}
    this.records.set(s.id,item);
  }
  filter(query={}){
    const period=query.period||'30',topic=query.topic||'';
    if(!['7','30','90','all'].includes(period))throw fail('Неизвестный период');
    const after=period==='all'?0:this.now()-Number(period)*86400000;
    return {after,period,topic,records:[...this.records.values()].filter(r=>r.startedAt>=after&&(!topic||r.topic===topic))};
  }
  history(person,query){const {records}=this.filter(query);return {storage:this.storage(),items:records.filter(r=>r.person.id===person.id).sort((a,b)=>b.startedAt-a.startedAt).map(({person,...rest})=>rest)};}
  leaderboard(person,query){
    const {after,topic,period}=this.filter(query),groups=new Map();
    for(const r of this.records.values()){
      if(r.mode!=='ai'||!r.reportAt||r.reportAt<after||(topic&&r.topic!==topic))continue;
      let group=groups.get(r.person.id);if(!group){group={person:r.person,scenarios:new Map(),days:new Set()};groups.set(r.person.id,group);}
      const old=group.scenarios.get(r.scenarioId);if(!old||r.reportAt>old.reportAt)group.scenarios.set(r.scenarioId,r);
      group.days.add(localDay(r.reportAt));
    }
    const rows=[...groups.values()].map(g=>({participant:g.person.id,name:g.person.name,completed:g.scenarios.size,plans:[...g.scenarios.values()].filter(r=>r.planAt).length,days:g.days.size,average:mean([...g.scenarios.values()].map(r=>r.total))})).sort((a,b)=>b.completed-a.completed||b.days-a.days||a.name.localeCompare(b.name,'ru'));
    const ranked=rows.map((r,i)=>({...r,place:i+1,isYou:r.participant===person.id}));
    return {storage:this.storage(),period,topic,totalParticipants:rows.length,items:ranked.slice(0,10).map(({participant,...r})=>r),you:ranked.find(r=>r.isYou)?(({participant,...r})=>r)(ranked.find(r=>r.isYou)):null};
  }
  feedback(person,scenario,input){
    if(!Number.isInteger(input.rating)||input.rating<1||input.rating>5)throw fail('Выберите полезность от 1 до 5');
    if(typeof input.text!=='string'||input.text.length>2000)throw fail('Отзыв — до 2000 символов');
    if(!['Впечатление','Ошибка','Непонятное условие','Предложение'].includes(input.category))throw fail('Выберите тип отзыва');
    const key=person.id+':'+scenario.id,previous=this.reviews.get(key);
    if(previous&&this.now()-previous.at<10000)throw fail('Отзыв уже сохранен. Изменить его можно через 10 секунд.',429);
    if(!previous&&this.reviews.size>=1000)throw fail('Лимит отзывов пилота исчерпан. Обратитесь к организатору.',429);
    const record={person,scenarioId:scenario.id,title:scenario.title,topic:scenario.topic,rating:input.rating,text:input.text.trim(),category:input.category,at:this.now()};
    this.reviews.set(key,record);return {ok:true,review:{rating:record.rating,text:record.text,category:record.category},storage:this.storage()};
  }
  ownFeedback(person,id){const item=this.reviews.get(person.id+':'+id);return {review:item?{rating:item.rating,text:item.text,category:item.category}:null,storage:this.storage()};}
  analytics(query){
    const {records,after,topic}=this.filter(query),reviews=[...this.reviews.values()].filter(r=>r.at>=after&&(!topic||r.topic===topic));
    const started=records.length,reported=records.filter(r=>r.reportAt).length,planned=records.filter(r=>r.planAt).length;
    const topics=[...new Set([...records.map(r=>r.topic),...reviews.map(r=>r.topic)])].map(name=>{const list=records.filter(r=>r.topic===name);return {name,started:list.length,reported:list.filter(r=>r.reportAt).length,planned:list.filter(r=>r.planAt).length};});
    const scenarios=[...new Set([...records.map(r=>r.scenarioId),...reviews.map(r=>r.scenarioId)])].map(id=>{const list=records.filter(r=>r.scenarioId===id),feedback=reviews.filter(r=>r.scenarioId===id),sample=list[0]||feedback[0];return {id,title:sample.title,topic:sample.topic,started:list.length,reported:list.filter(r=>r.reportAt).length,planned:list.filter(r=>r.planAt).length,usefulness:mean(feedback.map(r=>r.rating))};}).sort((a,b)=>b.started-a.started);
    const days=new Map();for(const record of records){const day=localDay(record.startedAt),counts=days.get(day)||{started:0,reported:0};counts.started++;if(record.reportAt)counts.reported++;days.set(day,counts);}
    const daily=Array.from({length:14},(_,i)=>{const date=localDay(this.now()-(13-i)*86400000);return {date,...(days.get(date)||{started:0,reported:0})};});
    return {storage:this.storage(),totals:{participants:new Set(records.map(r=>r.person.id)).size,started,reported,planned,usefulness:mean(reviews.map(r=>r.rating)),reviewCount:reviews.length,ai:records.filter(r=>r.mode==='ai').length,demo:records.filter(r=>r.mode==='demo').length},topics,scenarios,daily,reviews:reviews.sort((a,b)=>b.at-a.at).slice(0,100).map(({person,...r})=>({...r,name:person.name})),recent:records.sort((a,b)=>b.startedAt-a.startedAt).slice(0,30).map(r=>({title:r.title,name:r.person.name,mode:r.mode,startedAt:r.startedAt,turns:r.turns,status:r.planAt?'План готов':r.reportAt?'Разбор готов':'Без разбора'}))};
  }
}
