import {randomInt,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
// Deliver codes only through the configured private message channel. State expires on restart.
export class LoginCodes{
  constructor(send,{clock=Date.now}={}){this.send=send;this.clock=clock;this.secret=randomBytes(32);this.pending=new Map();this.quotas=new Map();this.inFlight=0;}
  digest(owner,code){return createHmac('sha256',this.secret).update(owner+'\0'+code).digest();}
  sweep(now){for(const [key,item]of this.pending)if(item.expiresAt<=now)this.pending.delete(key);for(const [key,item]of this.quotas)if(item.until<=now)this.quotas.delete(key);}
  consume(key,max,window,now){
    let item=this.quotas.get(key);
    if(!item){if(this.quotas.size>=10000)throw fail('Слишком много запросов входа. Повторите позже.',429);item={count:0,until:now+window};this.quotas.set(key,item);}
    if(++item.count>max)throw fail('Лимит отправки кодов исчерпан. Повторите позже.',429);
  }
  async request(owner,person,address){
    if(!this.send)throw fail('Организатор еще не настроил отправку кодов в Битрикс24.',503);
    const now=this.clock();this.sweep(now);
    if(this.pending.get(owner)?.resendAt>now)throw fail('Повторный код можно запросить через минуту.',429);
    this.consume('owner:'+owner,5,3600000,now);this.consume('ip:'+address,15,3600000,now);
    if(person?.email)this.consume('email:'+person.email.toLowerCase(),5,3600000,now);
    this.consume('global',80,86400000,now);
    if(this.inFlight>=3||this.pending.size>=5000)throw fail('Отправка занята. Повторите позже.',429);
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    const item={hash:this.digest(owner,code),person:person?.email?person:null,attempts:0,expiresAt:now+300000,resendAt:now+60000};
    this.pending.set(owner,item);this.inFlight++;
    try{if(item.person){const delivery=await this.send({email:person.email,code});if(delivery?.position)item.person={...item.person,position:delivery.position};}}
    catch(error){this.pending.delete(owner);throw error;}
    finally{this.inFlight--;}
    return {verificationRequired:true,expiresIn:300,resendAfter:60,message:'Если ФИО есть в списке и учетная запись найдена, код отправлен в личные сообщения Битрикс24.'};
  }
  verify(owner,code){
    const item=this.pending.get(owner),now=this.clock();
    if(!item||item.expiresAt<=now){this.pending.delete(owner);throw fail('Код истек. Запросите новый код.',401);}
    if(++item.attempts>5){this.pending.delete(owner);throw fail('Попытки исчерпаны. Запросите новый код.',429);}
    if(typeof code!=='string'||!/^\d{6}$/.test(code)||!timingSafeEqual(item.hash,this.digest(owner,code))||!item.person){
      if(item.attempts===5)this.pending.delete(owner);
      throw fail('Код не подошел. Проверьте шесть цифр из сообщения Битрикс24.',401);
    }
    this.pending.delete(owner);return {fullName:item.person.fullName,...(item.person.position?{position:item.person.position}:{}),...(item.person.profileId?{profileId:item.person.profileId}:{})};
  }
  cancel(owner){this.pending.delete(owner);}
}
