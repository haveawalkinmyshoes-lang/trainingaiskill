import {createHash} from 'node:crypto';
import {route} from './domain.mjs';
import {Trainer} from './trainer.mjs';
import {actorInstruction,actorRoleViolation,conversationRoles} from './roleplay.mjs';
import {auditFixture} from './audit-fixtures.mjs';
const managers=new Set(['Топ-менеджмент','Руководитель отдела','Руководитель группы / заместитель']);
const fail=(text,status=400)=>Object.assign(new Error(text),{status});
function profileFor(config,scenario,fixture){
  const manager=/руководитель/i.test(scenario.learner_role),words=scenario.learner_role.toLowerCase().split(/[\s,]+/).filter(w=>w.length>4&&!/^(руковод|отдел|групп|команд|специ|участ)/.test(w)).map(w=>w.slice(0,5));
  return config.job_profiles.flatMap(p=>{try{route(config,scenario.topic,p.id,scenario.id);const title=p.title.toLowerCase();return [{profile:p,score:(p.title===scenario.learner_role?100:0)+(p.family===fixture.family?1000:0)+(managers.has(p.job_level)===manager?40:-40)+words.filter(w=>title.includes(w)).length*10}];}catch{return [];}}).sort((a,b)=>b.score-a.score)[0]?.profile;
}
export class ScenarioAudit{
  constructor(library,connection,call,{maxUSD=5,maxCalls=200}={}){
    this.library=library;this.connection={...connection};this.call=call;this.maxUSD=maxUSD;this.maxCalls=maxCalls;this.records=new Map();this.inFlight=new Map();this.calls=0;this.costUSD=0;this.reservedUSD=0;this.unknownUsage=0;this.usage={input:0,cached:0,cacheWrite:0,output:0,reasoning:0};this.startedAt=new Date().toISOString();
    this.fixtures=library.config.scenarios.map(s=>{const f=auditFixture(s,library.config),profile=profileFor(library.config,s,f);if(!profile)throw Error('No audit profile for '+s.id);return {scenario:s,fixture:f,profile};});
    this.version=createHash('sha256').update(JSON.stringify({config:library.config,fixtures:this.fixtures.map(f=>({id:f.scenario.id,profile:f.profile.id,messages:f.fixture.messages})),instructions:this.fixtures.map(f=>actorInstruction({scenario:f.scenario,profile:f.profile}))})).digest('hex');
  }
  status(){return {scope:'synthetic_scenario_audit',version:this.version,model:this.connection.model,startedAt:this.startedAt,scenarioCount:this.fixtures.length,completed:[...this.records.values()].filter(r=>r.status==='complete').length,errors:[...this.records.values()].filter(r=>r.status==='error').length,running:this.inFlight.size,plannedMaximumCalls:this.fixtures.reduce((n,f)=>n+f.fixture.messages.length+1,0),calls:this.calls,costUSD:Number(this.costUSD.toFixed(6)),usage:{...this.usage},unknownUsage:this.unknownUsage,limits:{calls:this.maxCalls,costUSD:this.maxUSD},method:'Fixed reference learner messages; live production actor with role repair; live final assessor. Step grades and monthly plans are not generated. No employee sessions or journal records.'};}
  async paid(args,record,attempt=0){
    if(this.connection.model!=='gpt-6.1-sol')throw fail('Аудит настроен на gpt-6.1-sol',409);
    if(this.calls>=this.maxCalls)throw fail('Достигнут лимит запросов аудита',429);
    const inputBytes=Buffer.byteLength(String(args[1])+JSON.stringify(args[2])+JSON.stringify(args[3])+JSON.stringify(args[6]?.conversation||[]),'utf8')+2000;
    const reserve=inputBytes*2.5/1000000+8000*10/1000000;
    if(this.costUSD+this.reservedUSD+reserve>this.maxUSD)throw fail('Достигнут защитный бюджет аудита',429);
    this.calls++;this.reservedUSD+=reserve;const timing=Date.now();let measured=false,charge=0;
    const transport=args[6]||{};args[6]={...transport,onUsage:u=>{
      const integer=n=>Number.isSafeInteger(n)&&n>=0?n:0;
      const input=integer(u.input_tokens??u.prompt_tokens),output=integer(u.output_tokens??u.completion_tokens),cached=integer(u.input_tokens_details?.cached_tokens??u.prompt_tokens_details?.cached_tokens),writes=integer(u.input_tokens_details?.cache_write_tokens),reasoning=integer(u.output_tokens_details?.reasoning_tokens??u.completion_tokens_details?.reasoning_tokens);
      charge=(Math.max(0,input-cached-writes)*2+cached*.1+writes*2.5+output*10)/1000000;
      this.costUSD+=charge;record.costUSD+=charge;for(const [key,value]of Object.entries({input,cached,cacheWrite:writes,output,reasoning}))this.usage[key]+=value;measured=true;
    }};
    let result,error;try{result=await this.call(...args);}catch(caught){error=caught;}finally{this.reservedUSD-=reserve;if(!measured){this.unknownUsage++;this.costUSD+=reserve;record.costUSD+=reserve;}record.requests.push({kind:args[4],durationMs:Date.now()-timing,costUSD:Number(charge.toFixed(6)),usageKnown:measured});}
    if(error){const f=error.aiFailure;if(attempt===0&&(f?.kind==='timeout'||f?.kind==='network'||f?.kind==='provider'&&f.httpStatus>=500)){record.flags.push('transient_api_retry');return this.paid(args,record,1);}throw error;}return result;
  }
  async one(item){
    const id=item.scenario.id;if(this.records.has(id))return this.records.get(id);if(this.inFlight.has(id))return this.inFlight.get(id);
    const promise=this.simulate(item);this.inFlight.set(id,promise);try{return await promise;}finally{this.inFlight.delete(id);}
  }
  async simulate({scenario,fixture,profile}){
    const record={id:scenario.id,title:scenario.title,topic:scenario.topic,status:'running',mode:scenario.mode,sourceRole:scenario.learner_role,profile:{id:profile.id,title:profile.title,family:profile.family,expectedFamily:fixture.family},character:scenario.character,brief:scenario.brief,hidden:scenario.hidden,success:scenario.success,pitfall:scenario.pitfall,monthlyHomework:scenario.monthly_homework,script:fixture.messages,weakTurn:fixture.weakTurn,history:[],turns:[],requests:[],costUSD:0,report:null,error:null,flags:[],startedAt:new Date().toISOString()};
    let trainer,session;
    try{
      trainer=new Trainer(this.library,async(...args)=>{
        if(args[4]==='trainer_grade')return {scores:args[2].competencies.map(c=>({id:c.id,score:null,quote:'',reason:'Пошаговая оценка не запускалась в техническом аудите.'}))};
        // Final assessment is based on the actual transcript, without synthetic null step scores.
        if(args[4]==='trainer_final'){args[2]={...args[2]};delete args[2].stepScores;}
        return this.paid(args,record);
      });
      const start=trainer.start('synthetic-audit',{topic:scenario.topic,scenarioId:scenario.id,profileId:profile.id,mode:'ai',difficulty:'начальный'},this.connection);session=trainer.get(start.id,'synthetic-audit');
      for(const [index,message]of fixture.messages.entries()){
        if(session.complete){record.flags.push(index<fixture.weakTurn?'closed_before_weak_probe':'closed_before_reference_repair');break;}
        const before=session.history.length;await trainer.turn(session,message,'audit-'+(index+1));const reply=session.history.at(-1).text;
        record.turns.push({turn:index+1,kind:index+1===fixture.weakTurn?'weak':index===0?'diagnostic':'reference_repair',message,reply,complete:session.complete,roleViolation:actorRoleViolation(reply,session.context),addedMessages:session.history.length-before});
        if(index+1===fixture.weakTurn&&session.complete)record.flags.push('weak_solution_ended_dialogue');
      }
      record.modelCompleted=session.complete;if(!session.complete)record.flags.push('audit_turn_limit_reached');
      await trainer.finalize(session);const {unassessed,...report}=session.report;record.report=report;record.status='complete';
      if(profile.family!==fixture.family)record.flags.push('profile_family_fallback');
      if(/руководитель/i.test(scenario.learner_role)&&!managers.has(profile.job_level))record.flags.push('profile_level_mismatch');
      if(record.turns.some(t=>t.roleViolation))record.flags.push('role_violation');
    }catch(error){record.status='error';record.error=String(error.message||'Audit error').slice(0,300);}
    if(session)record.history=session.history.map(({role,kind,text})=>({role,kind,text}));
    record.costUSD=Number(record.costUSD.toFixed(6));record.finishedAt=new Date().toISOString();this.records.set(scenario.id,record);return record;
  }
  async run(args){
    if(args.action==='status')return this.status();
    if(args.action!=='run')throw fail('Неизвестное действие аудита');
    const offset=args.offset??0,limit=args.limit??1;if(!Number.isInteger(offset)||offset<0||offset>=this.fixtures.length||!Number.isInteger(limit)||limit<1||limit>3)throw fail('Аудит: offset 0–44, limit 1–3');
    const selected=this.fixtures.slice(offset,offset+limit),settled=await Promise.allSettled(selected.map(item=>this.one(item)));
    return {status:this.status(),cases:settled.map((r,i)=>r.status==='fulfilled'?r.value:{id:selected[i].scenario.id,status:'error',error:'Audit execution failed'})};
  }
}
