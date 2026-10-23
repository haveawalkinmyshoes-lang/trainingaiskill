// Quotes are selected from literal source substrings, not rewritten by the model.
export function quoteOptions(messages,perMessage=8){
  const result=[];
  for(const text of messages){
    const chunks=[];
    for(let start=0;start<text.length;){
      let end=Math.min(start+240,text.length);
      if(end<text.length){
        const space=text.lastIndexOf(' ',end);
        if(space>start+100)end=space;
        if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;
      }
      const value=text.slice(start,end).trim();if(value)chunks.push(value);
      start=end;
    }
    const count=Math.min(perMessage,chunks.length);
    for(let i=0;i<count;i++)result.push(chunks[count===1?0:Math.round(i*(chunks.length-1)/(count-1))]);
  }
  const unique=[...new Set(result)];
  return unique.length<=96?unique:Array.from({length:96},(_,i)=>unique[Math.round(i*(unique.length-1)/95)]);
}
