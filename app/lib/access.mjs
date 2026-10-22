import {readFile} from 'node:fs/promises';

export function normalizeFullName(value){
  return typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('ru').replaceAll('ё','е'):'';
}
function nameVariants(fullName){
  const parts=normalizeFullName(fullName).split(' '),variants=new Set([parts.join(' ')]);
  if(parts.length===2||parts.length===3)variants.add([parts[1],parts[0],...parts.slice(2)].join(' '));
  if(parts.length===3)variants.add([parts[1],parts[2],parts[0]].join(' '));
  return variants;
}
export async function loadEmployeeAllowlist({env=process.env,readText=readFile}={}){
  let source=env.EMPLOYEE_ALLOWLIST_FILE?
    await readText(env.EMPLOYEE_ALLOWLIST_FILE,'utf8'):env.EMPLOYEE_ALLOWLIST_JSON;
  if(!source){
    for(const filename of ['/etc/secrets/employees.json','/etc/secrets/employees.env']){
      let secret;
      try{secret=await readText(filename,'utf8');}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')continue;throw error;}
      secret=secret.replace(/^\uFEFF/,'');
      if(filename.endsWith('.env')){
        source=secret.match(/^EMPLOYEE_ALLOWLIST_JSON=(.*)$/m)?.[1]?.trim();
        if(!source)throw new Error('В секретном файле employees.env не найден EMPLOYEE_ALLOWLIST_JSON');
      }else source=secret;
      break;
    }
  }
  if(!source)return [];
  const records=JSON.parse(source);
  if(!Array.isArray(records))throw new Error('Список допуска сотрудников должен быть массивом JSON');
  return records;
}
export class EmployeeAccess{
  constructor(records,{required=false,ttlMs=8*60*60*1000}={}){
    this.required=required||records.length>0;this.ttlMs=ttlMs;this.people=new Map();this.nameIndex=new Map();this.sessions=new Map();this.attempts=new Map();
    for(const record of records){
      const fullName=typeof record==='string'?record:record?.fullName;
      if(record?.enabled===false)continue;
      if(typeof fullName!=='string'||fullName.length>200||!normalizeFullName(fullName))throw new Error('Некорректное ФИО в списке допуска');
      const key=normalizeFullName(fullName),display=fullName.normalize('NFKC').trim().replace(/\s+/gu,' ');
      const email=typeof record==='object'&&typeof record.email==='string'?record.email.trim():'';
      if(email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw new Error('Некорректная почта в списке допуска');
      if(this.people.has(key))throw new Error('Повторяющееся ФИО в списке допуска: используйте уникальные полные имена');
      this.people.set(key,{fullName:display,...(email?{email}:{})});
      for(const variant of nameVariants(display)){
        if(!this.nameIndex.has(variant))this.nameIndex.set(variant,new Set());
        this.nameIndex.get(variant).add(key);
      }
    }
  }
  current(owner,now=Date.now()){
    const session=this.sessions.get(owner);
    if(!session)return null;
    if(session.expiresAt<=now){this.sessions.delete(owner);return null;}
    return {fullName:session.fullName};
  }
  login(owner,fullName,now=Date.now()){
    if(!this.people.size)throw Object.assign(new Error('Список сотрудников пока не загружен. Обратитесь к организатору тестирования.'),{status:503});
    for(const [id,item]of this.attempts)if(item.until<=now)this.attempts.delete(id);
    let attempts=this.attempts.get(owner);
    if(!attempts){if(this.attempts.size>=5000)throw Object.assign(new Error('Слишком много попыток входа. Попробуйте позже.'),{status:429});attempts={count:0,until:now+10*60*1000};this.attempts.set(owner,attempts);}
    if(++attempts.count>10)throw Object.assign(new Error('Слишком много попыток входа. Повторите через 10 минут.'),{status:429});
    const key=typeof fullName==='string'&&fullName.length<=200?normalizeFullName(fullName):'';
    const matches=this.nameIndex.get(key);
    if(matches?.size>1)throw Object.assign(new Error('ФИО неоднозначно. Укажите полное ФИО с отчеством или обратитесь к организатору.'),{status:400});
    const person=matches?.size===1?this.people.get([...matches][0]):null;
    if(!person)throw Object.assign(new Error('Доступ не найден. Введите полное ФИО как в списке сотрудников или обратитесь к организатору.'),{status:401});
    return {...person};
  }
  grant(owner,person,now=Date.now()){this.sessions.set(owner,{...person,expiresAt:now+this.ttlMs});}
  logout(owner){this.sessions.delete(owner);}
}
