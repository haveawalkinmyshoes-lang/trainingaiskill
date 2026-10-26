const femaleNames=new Set('аврора агата агнесса ада азалия айгуль аксинья алевтина александра алина алиса алла альбина амелия анастасия ангелина анжела анна антонина арина ася белла валентина валерия варвара василиса вера вероника виктория виолетта галина дарья даша диана дина евгения евдокия екатерина елена елизавета жанна зинаида злата зоя инга инна ирина карина кира кристина ксения лариса лена лилия любовь людмила майя маргарита марианна марина мария милана надежда наталья наталия нина нонна оксана олеся ольга полина раиса регина римма роза светлана софия софья стелла таисия тамара татьяна ульяна фаина эвелина элина элла эльвира эмма юлия яна'.split(' '));
const maleNames=new Set('адам адриан азамат александр алексей альберт анатолий андрей антон арсен арсений артем артемий артур архип ашот богдан борис вадим валентин валерий василий виктор виталий владимир владислав всеволод вячеслав гавриил геннадий георгий герман глеб григорий давид даниил данила данил демид денис дмитрий евгений егор елисей захар игнат игнатий игорь иван илья иосиф кирилл клим константин костя кузьма лев леонид макар максим марат марк матвей михаил назар никита николай олег осип павел петр платон прохор радик рафаэль ринат роберт родион роман ростислав руслан савва савелий святослав семен серафим сергей станислав степан тарас тимофей тимур тихон федор филипп эдуард эмиль юрий яков ярослав'.split(' '));
const normalize=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('ru').replaceAll('ё','е');
const hash=value=>[...normalize(value)].reduce((n,c)=>(Math.imul(n,31)+c.codePointAt(0))>>>0,0);
export const portraitFiles=Object.freeze(['male','female'].flatMap(g=>Array.from({length:4},(_,i)=>`/avatars/${g}-0${i+1}.webp`)));
export function avatarGender(name,explicit){
  const known=normalize(explicit);if(['f','female','женский'].includes(known))return 'female';if(['m','male','мужской'].includes(known))return 'male';
  const words=normalize(name).split(',')[0].split(/[\s-]+/);
  // Patronymics disambiguate names such as Sasha or Zhenya. Job titles do not establish gender.
  if(words.some(w=>/(?:овна|евна|ична|инична)$/.test(w)))return 'female';
  if(words.some(w=>/(?:ович|евич|ильич|кузьмич)$/.test(w)))return 'male';
  const f=words.some(w=>femaleNames.has(w)),m=words.some(w=>maleNames.has(w));return f===m?null:f?'female':'male';
}
function candidates(name,gender){const start=hash(name)%4;return Array.from({length:4},(_,i)=>`/avatars/${gender}-0${(start+i)%4+1}.webp`);}
export function alternatePortrait(name,gender,reserved=[]){const resolved=avatarGender(name,gender),choices=resolved?candidates(name,resolved):Array.from({length:portraitFiles.length},(_,i)=>portraitFiles[(hash(name)+i)%portraitFiles.length]);return choices.find(src=>!reserved.includes(src))||null;}
export function accountPortrait(name,gender){return alternatePortrait(name,gender);}
// These are presentation choices for fictional, unnamed characters, not inferred employee data.
const characterGenders=new Map([
  ['Директор по продажам','male'],['Тренер по SMART','female'],['Саша, новый специалист','male'],
  ['Непосредственный руководитель','female'],['Коуч-оппонент','male'],['Коуч по рабочей рефлексии','female']
].map(([name,gender])=>[normalize(name),gender]));
export function characterGender(name,explicit){return avatarGender(name,explicit)||characterGenders.get(normalize(name))||(hash(name)%2?'female':'male');}
export function scenarioPortraitPages(scenarios,reserved=null,pageSize=6){
  const pages=[];let page=[],used=new Set(reserved?[reserved]:[]);
  const next=()=>{if(page.length)pages.push(page);page=[];used=new Set(reserved?[reserved]:[]);};
  for(const scenario of scenarios){
    const gender=characterGender(scenario.character,scenario.gender),choices=candidates(scenario.character,gender);
    if(page.length>=pageSize||(choices.length&&choices.every(src=>used.has(src))))next();
    const src=choices.find(src=>!used.has(src))||null;if(src)used.add(src);
    page.push({scenario,src,gender});
  }
  next();return pages;
}
