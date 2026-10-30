import {readFile} from 'node:fs/promises';
import {createDecipheriv,createHmac} from 'node:crypto';
import {normalizeFullName} from './access.mjs';
const file=new URL('../data/employee-roles.enc.json',import.meta.url);
export const roleKey=(secret,name)=>createHmac('sha256',secret).update('neurotrainer:employee-role-key:v1\0'+normalizeFullName(name)).digest('hex');
export const roleEncryptionKey=secret=>createHmac('sha256',secret).update('neurotrainer:employee-roles:v1').digest();
export async function withStoredRoles(records,secret,{readText=readFile}={}){
  if(!secret||!records.some(p=>typeof p==='string'||!p.position&&!p.profileId))return records;
  let map;
  try{
    const blob=JSON.parse(await readText(file,'utf8'));
    if(blob.version!==1)return records;
    const decipher=createDecipheriv('aes-256-gcm',roleEncryptionKey(secret),Buffer.from(blob.iv,'base64'));decipher.setAuthTag(Buffer.from(blob.tag,'base64'));
    map=JSON.parse(Buffer.concat([decipher.update(Buffer.from(blob.data,'base64')),decipher.final()]).toString('utf8'));
  }catch{return records;}
  // This supplements the private allowlist; the encrypted registry never grants admission.
  return records.map(record=>{const person=typeof record==='string'?{fullName:record}:record;if(person.position||person.profileId)return record;const position=map[roleKey(secret,person.fullName)];return typeof position==='string'&&position.length<=300?{...person,position}:record;});
}
