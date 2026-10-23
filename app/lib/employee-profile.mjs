export const normalizePosition=value=>String(value||'').normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/[.(),]/g,' ').replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
const synonyms={
  'руководитель hr':'ROLE_158','ведущий hr менеджер':'ROLE_159',
  'руководитель группы закупок рф':'ROLE_090',
  'руководитель отдела прямых продаж':'ROLE_010','руководитель отдела клиентских продаж':'ROLE_010',
  'руководитель отдела по работе с федеральными сетевыми клиентами':'ROLE_010',
  'руководитель отдела развития информационных систем':'ROLE_139',
  'руководитель отдела электронной коммерции':'ROLE_008',
  'заместитель руководителя оптового отдела продаж + ргп юфо':'ROLE_014',
  'руководитель проектного отдела в отделе скс':'ROLE_170',
};
export function resolveEmployeeProfile(config,employee,{allowRelated=true}={}){
  if(!employee)return null;
  const position=normalizePosition(employee.position);
  let profile,match='exact';
  if(employee.profileId)profile=config.job_profiles.find(p=>p.id===employee.profileId);
  if(!profile&&position){const matches=config.job_profiles.filter(p=>[p.title,...p.aliases].some(name=>normalizePosition(name)===position));if(matches.length===1)profile=matches[0];}
  if(!profile&&position&&synonyms[position]){profile=config.job_profiles.find(p=>p.id===synonyms[position]);match='synonym';}
  if(!profile&&position&&allowRelated){
    let id;
    if(/^руководитель группы продаж\b/u.test(position)||position.startsWith('руководитель группы продаж ')||position.startsWith('ргп '))id='ROLE_018';
    else if(position.startsWith('руководитель группы розничных продаж'))id='ROLE_018';
    else if(position.startsWith('руководитель отдела')||position.startsWith('руководитель международного отдела')||position.startsWith('руководитель трейд-маркетинга'))id='ROLE_232';
    else if(position.startsWith('руководитель направления'))id='ROLE_233';
    else if(position.startsWith('менеджер по hr проектам'))id='ROLE_160';
    if(id){profile=config.job_profiles.find(p=>p.id===id);match=id==='ROLE_232'||id==='ROLE_233'?'general':'related';}
  }
  return profile?{profile,position:employee.position||profile.title,match}:null;
}
