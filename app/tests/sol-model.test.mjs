import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredCall,schemas} from '../lib/ai.mjs';
test('Sol 6.1: оба протокола сохраняют строгую схему, поддерживаемый reasoning и запас для reasoning-токенов',async()=>{
  for(const style of ['responses','chat']){
    let body;const result=await structuredCall({key:'fixture',model:'gpt-6.1-sol',base:'https://api.openai.com/v1',style},'Проверка',{},schemas.connection,'test',async(_,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>style==='chat'?{choices:[{message:{content:'{"ok":true}'}}]}:{status:'completed',output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]}};});
    assert(result.ok);assert.equal(body.model,'gpt-6.1-sol');assert.equal(style==='responses'?body.reasoning.effort:body.reasoning_effort,'low');assert.equal(style==='responses'?body.max_output_tokens:body.max_completion_tokens,8000);assert(!Object.hasOwn(body,'temperature'));assert(!Object.hasOwn(body,'top_p'));assert(style==='responses'?body.text.format.strict:body.response_format.json_schema.strict);
    if(style==='responses')assert.equal(body.store,false);
  }
  await assert.rejects(()=>structuredCall({key:'fixture',model:'gpt-6.1-sol',reasoningEffort:'none'},'',{},schemas.connection,'test'),/reasoning effort/);
});
test('Настройки Sol не меняют запросы к прежней модели',async()=>{
  let body;await structuredCall({key:'fixture',model:'gpt-4.1-mini',base:'https://api.openai.com/v1'},'',{},schemas.connection,'test',async(_,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]})};});assert(!Object.hasOwn(body,'reasoning'));assert.equal(body.max_output_tokens,3000);
});
