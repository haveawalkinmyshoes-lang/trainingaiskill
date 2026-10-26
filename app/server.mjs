import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadLibrary, publicCatalog, availableScenarios, route } from './lib/domain.mjs';
import { safeConnection, structuredCall, schemas, safeAIFailure } from './lib/ai.mjs';
import { Trainer } from './lib/trainer.mjs';
import {EmployeeAccess,loadEmployeeAllowlist} from './lib/access.mjs';
import {LoginCodes} from './lib/login-code.mjs';
import {createBitrixLoginSender} from './lib/bitrix-mcp.mjs';
import {resolveEmployeeProfile} from './lib/employee-profile.mjs';
import {codeException,exemptBitrixId} from './lib/code-exceptions.mjs';
import {bridgeSettings,createAdminBridge} from './lib/admin-bridge.mjs';
import {PracticeJournal} from './lib/practice-journal.mjs';
import {checkRoleplay} from './lib/roleplay-check.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
function httpError(message,status=400){return Object.assign(new Error(message),{status});}
async function body(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw httpError('Ожидается JSON',415);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>48000)throw httpError('Слишком большой запрос',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw httpError('Некорректный JSON');}
}
async function envFile(){
  try{const text=await readFile(path.join(here,'.env'),'utf8');for(const line of text.split(/\r?\n/)){
    const match=line.match(/^([A-Z_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^['"]|['"]$/g,'');
  }}catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function createApp(options={}){
  const hosted=options.hosted??process.env.NODE_ENV==='production';
  const access=new EmployeeAccess(options.employeeAllowlist??await loadEmployeeAllowlist(),{required:options.accessRequired??hosted});
  const sendCode=options.sendCode??createBitrixLoginSender();
  const codeVerification=options.codeVerification??(hosted||Boolean(sendCode)||process.env.AUTH_CODE_VERIFICATION==='true');
  const codes=new LoginCodes(sendCode);
  const bypassCode=options.codeBypass??codeException,lookupEmployee=options.lookupEmployee??sendCode?.lookupEmployee;
  const library=options.library||await loadLibrary(path.join(here,'..','02_Инструкция_модели_Нейротренера.md'));
  const connection={key:process.env.OPENAI_API_KEY||'',model:process.env.OPENAI_MODEL||'gpt-4.1-mini',
    base:process.env.OPENAI_BASE_URL||'https://api.openai.com/v1',style:process.env.AI_API_STYLE||'responses',...options.connection};
  let usageStart=Date.now(),aiCalls=0,lastAIFailure=null,lastAISuccessAt=null;
  const provider=options.call||structuredCall;
  const call=async(...args)=>{
    if(hosted){
      if(Date.now()-usageStart>=86400000){usageStart=Date.now();aiCalls=0;}
      if(aiCalls>=Number(process.env.MAX_AI_CALLS_PER_DAY||200))throw httpError('Лимит запросов пилота исчерпан. Попробуйте позже.',429);
      aiCalls++;
    }
    try{const result=await provider(...args);lastAISuccessAt=new Date().toISOString();return result;}
    catch(error){lastAIFailure={at:new Date().toISOString(),...safeAIFailure(error)};throw error;}
  };
  const trainer=new Trainer(library,call),owners=new Map();
  const adminConfig=options.bridgeSettings??await bridgeSettings();
  const journal=new PracticeJournal({secret:adminConfig.token,local:!hosted&&!access.required});
  const bridge=createAdminBridge({settings:adminConfig,library,trainer,
    status:()=>({ok:true,revision:process.env.RENDER_GIT_COMMIT||'local',hosting:hosted?'production':'local',
      topics:library.config.ui.topic_selector.options,scenarioCount:library.config.scenarios.length,profileCount:library.config.job_profiles.length,
      ai:{configured:Boolean(connection.key),model:connection.model,style:connection.style,callsInCurrentWindow:aiCalls,windowStartedAt:new Date(usageStart).toISOString(),limitPerDay:Number(process.env.MAX_AI_CALLS_PER_DAY||200),lastFailure:lastAIFailure,lastSuccessAt:lastAISuccessAt},
      access:{required:access.required,allowlistConfigured:access.people.size>0,codeVerification,bitrixConfigured:Boolean(sendCode)},
      dataStorage:'in_memory_reset_on_restart'}),
    checkAI:async(args={})=>{const tested={...connection,...(args.model?{model:args.model}:{})};if(args.roleplay)return checkRoleplay(library,tested,call);const result=await call(tested,'Верни JSON {"ok":true}. Это проверка соединения.',{},schemas.connection,'trainer_bridge_connection');if(result.ok!==true)throw httpError('ИИ не подтвердил соединение',502);return {ok:true,model:tested.model};},
    ...(options.bridgeFetch?{fetchImpl:options.bridgeFetch}:{})});
  const server=http.createServer(async(req,res)=>{
    if(String(req.url||'').split('?')[0]==='/mcp')bridge.observe(req,res);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try{
      if(req.method==='GET'&&req.url==='/healthz')return send({ok:true});
      const host=req.headers.host||'';
      const publicUrl=hosted&&(process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL);
      if(hosted&&!publicUrl)throw httpError('Администратору нужно настроить PUBLIC_URL',503);
      if(!hosted&&!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))throw httpError('Недопустимый адрес приложения',403);
      const origin=hosted?new URL(publicUrl).origin:`http://${host}`;
      if(hosted&&host!==new URL(origin).host)throw httpError('Недопустимый адрес приложения',403);
      if(req.headers.origin&&req.headers.origin!==origin)throw httpError('Запрос разрешен только из интерфейса приложения',403);
      const url=new URL(req.url,origin);
      if(url.pathname==='/mcp')return await bridge.handle(req,res,body);
      if(url.pathname.startsWith('/api/')){
        let owner=req.headers.cookie?.match(/(?:^|;\s*)nt_owner=([a-f0-9]{48})(?:;|$)/)?.[1];
        if(!owner||!owners.has(owner)){
          if(req.method!=='GET')throw httpError('Откройте приложение перед отправкой запроса',403);
          if(owners.size>=5000)throw httpError('Слишком много подключений. Попробуйте позже.',429);
          owner=randomBytes(24).toString('hex');owners.set(owner,randomBytes(24).toString('hex'));
          res.setHeader('Set-Cookie',`nt_owner=${owner}; HttpOnly; SameSite=Strict; Path=/${hosted?'; Secure':''}`);
        }
        if(req.method!=='GET'&&req.headers['x-csrf-token']!==owners.get(owner))throw httpError('Обновите страницу: истек токен запроса',403);
        const accessStatus=()=>({required:access.required,configured:access.people.size>0,codeVerification,employee:access.current(owner),csrf:owners.get(owner)});
        if(req.method==='GET'&&url.pathname==='/api/auth/status')return send(accessStatus());
        if(req.method==='POST'&&['/api/auth/login','/api/auth/verify'].includes(url.pathname)){
          const input=await body(req);let person;
          if(url.pathname==='/api/auth/verify'){
            if(!codeVerification)throw httpError('Проверка кода не включена',400);
            person=codes.verify(owner,input.code);
          }else if(codeVerification){
            try{person=access.login(owner,input.fullName);}catch(error){if(error.status!==401)throw error;}
            if(person&&bypassCode(person)){
              if(!lookupEmployee)throw httpError('Организатору нужно проверить подключение Битрикс24.',503);
              const identity=await lookupEmployee(person.email);
              if(identity.id!==exemptBitrixId)throw httpError('Учетная запись Битрикс24 не соответствует исключению входа.',403);
              person={fullName:person.fullName,position:identity.position||person.position||''};codes.cancel(owner);
            }else{
              // Use the actual socket address; do not trust client-supplied forwarding headers.
              return send(await codes.request(owner,person,req.socket.remoteAddress||'unknown'));
            }
          }else person=access.login(owner,input.fullName);
          const oldOwner=owner;
          access.logout(oldOwner);journal.logout(oldOwner);owners.delete(oldOwner);
          for(const [id,s]of trainer.sessions)if(s.owner===oldOwner)trainer.sessions.delete(id);
          owner=randomBytes(24).toString('hex');owners.set(owner,randomBytes(24).toString('hex'));access.grant(owner,person);
          res.setHeader('Set-Cookie',`nt_owner=${owner}; HttpOnly; SameSite=Strict; Path=/${hosted?'; Secure':''}`);
          return send(accessStatus());
        }
        if(req.method==='POST'&&url.pathname==='/api/auth/logout'){
          await body(req);access.logout(owner);codes.cancel(owner);journal.logout(owner);owners.delete(owner);
          for(const [id,s]of trainer.sessions)if(s.owner===owner)trainer.sessions.delete(id);
          res.setHeader('Set-Cookie',`nt_owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${hosted?'; Secure':''}`);
          return send({ok:true});
        }
        if(access.required&&!access.current(owner))throw httpError('Для доступа войдите по ФИО из списка сотрудников.',401);
        const employee=access.current(owner),assignment=resolveEmployeeProfile(library.config,employee);
        const personalProfile=()=>{
          if(assignment)return assignment.profile.id;
          if(employee&&(hosted||codeVerification))throw httpError('Для вашей должности пока не настроен профиль оценки. Обратитесь к организатору.',422);
          return url.searchParams.get('profile');
        };
        if(req.method==='GET'&&url.pathname==='/api/bootstrap'){
          const catalog=publicCatalog(library.config),devProfile=!employee&&!hosted?catalog.profiles.find(p=>p.id==='ROLE_026'):null;
          return send({...catalog,employeeProfile:assignment?catalog.profiles.find(p=>p.id===assignment.profile.id):devProfile,employeePosition:assignment?.position||'',profileMatch:assignment?.match||null,csrf:owners.get(owner),connection:safeConnection(connection),hosting:{managed:hosted},practice:{storage:journal.storage(),adminAvailable:Boolean(journal.adminCode)||journal.local,adminAuthorized:journal.authorized(owner)}});
        }
        const participant=()=>journal.person(employee,owner),query=()=>({period:url.searchParams.get('period')||'30',topic:url.searchParams.get('topic')||''});
        if(req.method==='GET'&&url.pathname==='/api/history')return send(journal.history(participant(),query()));
        if(req.method==='GET'&&url.pathname==='/api/leaderboard')return send(journal.leaderboard(participant(),query()));
        if(req.method==='POST'&&url.pathname==='/api/admin/login'){const input=await body(req);return send(journal.loginAdmin(owner,input.code));}
        if(req.method==='GET'&&url.pathname==='/api/analytics'){
          if(!journal.authorized(owner))throw httpError('Для аналитики нужен код администратора',403);
          return send(journal.analytics(query()));
        }
        if(url.pathname==='/api/feedback'){
          if(req.method==='GET')return send(journal.ownFeedback(participant(),url.searchParams.get('scenario')));
          if(req.method==='POST'){
            const input=await body(req),scenario=library.config.scenarios.find(s=>s.id===input.scenarioId);
            if(!scenario)throw httpError('Упражнение не найдено',404);
            route(library.config,scenario.topic,personalProfile()||(!hosted?'ROLE_026':null),scenario.id);
            return send(journal.feedback(participant(),scenario,input));
          }
        }
        if(req.method==='GET'&&url.pathname==='/api/scenarios')return send({scenarios:availableScenarios(library.config,url.searchParams.get('topic'),personalProfile())});
        if(req.method==='POST'&&url.pathname==='/api/settings'){
          if(hosted)throw httpError('Настройки ИИ задает администратор в Render',403);
          const input=await body(req);let parsed;
          try{parsed=new URL(input.base);}catch{throw httpError('Укажите адрес API');}
          if(parsed.username||parsed.password||parsed.search||parsed.hash||!(parsed.protocol==='https:'||(parsed.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsed.hostname))))throw httpError('API требует HTTPS; HTTP разрешен только для локальной модели');
          if(typeof input.model!=='string'||!input.model.trim()||input.model.length>120||/[\r\n]/.test(input.model))throw httpError('Укажите название модели');
          if(!['responses','chat'].includes(input.style))throw httpError('Неизвестный протокол API');
          if(input.key!==undefined&&(typeof input.key!=='string'||input.key.length>2000||/[\r\n]/.test(input.key)))throw httpError('Некорректный ключ');
          connection.base=parsed.toString().replace(/\/$/,'');connection.model=input.model.trim();connection.style=input.style;
          if(input.clearKey)connection.key='';else if(input.key?.trim())connection.key=input.key.trim();
          return send(safeConnection(connection));
        }
        if(req.method==='POST'&&url.pathname==='/api/connection'){
          if(hosted)throw httpError('Проверка подключения доступна администратору',403);
          await body(req);const check=await call({...connection},'Верни JSON {"ok":true}. Это проверка соединения, без иных действий.',{},schemas.connection,'trainer_connection');
          if(check.ok!==true)throw httpError('ИИ не подтвердил соединение');
          return send({ok:true});
        }
        if(req.method==='POST'&&url.pathname==='/api/sessions'){
          const input=await body(req);
          if(assignment||employee&&(hosted||codeVerification))input.profileId=personalProfile();
          input.difficulty='начальный';
          const result=trainer.start(owner,input,connection);
          const session=trainer.get(result.id,owner);session.employee=access.current(owner);journal.capture(session);
          return send(result,201);
        }
        const match=url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)(?:\/(turn|hint|finalize|plan))?$/);
        if(match){
          const s=trainer.get(match[1],owner);
          if(req.method==='GET'&&!match[2])return send(trainer.view(s));
          if(req.method==='POST'){
            const input=await body(req);
            if(['turn','hint','finalize','plan'].includes(match[2])){
              const result=match[2]==='turn'?await trainer.turn(s,input.message,input.requestId):match[2]==='hint'?await trainer.hint(s):match[2]==='finalize'?await trainer.finalize(s):await trainer.plan(s,input.answers);
              journal.capture(s);return send(result);
            }
          }
        }
        throw httpError('Маршрут не найден',404);
      }
      const assets={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
      assets['/workspace.js']=['workspace.js','text/javascript'];assets['/workspace.css']=['workspace.css','text/css'];assets['/avatars.js']=['avatars.js','text/javascript'];
      // Only the eight packaged portraits are public; no arbitrary file paths.
      for(const gender of ['female','male'])for(let i=1;i<=4;i++){const name=gender+'-0'+i+'.webp';assets['/avatars/'+name]=['avatars/'+name,'image/webp'];}
      if(req.method!=='GET'&&req.method!=='HEAD')throw httpError('Метод не поддерживается',405);
      const asset=assets[url.pathname];if(!asset)throw httpError('Файл не найден',404);
      const content=await readFile(path.join(here,'public',asset[0]));
      res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
    }catch(error){bridge.recordError(error,req);if(!res.headersSent)send({error:error.message||'Не удалось обработать запрос'},error.status||400);else res.end();}
  });
  return {server,trainer,access,journal};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  await envFile();
  const port=Number(process.env.PORT||8765),{server}=await createApp();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Порт ${port} занят. Откройте http://127.0.0.1:${port} или задайте другой PORT.`:error.message);process.exitCode=1;});
  const bind=process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1';
  server.listen(port,bind,()=>console.log(`Нейротренер запущен: ${bind}:${port}`));
}
