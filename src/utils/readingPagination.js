export const normalizeReadingText=text=>String(text).replace(/\s+/g,' ').trim()
/** fits receives paragraphs as text; the browser measures them using the actual
 * reader font/width. Tests can supply a deterministic capacity without a DOM. */
export function paginateReading(paragraphs,fits){
 const pages=[];let segments=[]
 const flush=()=>{if(segments.length){pages.push({segments});segments=[]}}
 for(const [paragraph,text] of paragraphs.entries()){
  if(!text)continue
  let start=0
  while(start<text.length){
   const remaining={paragraph,start,end:text.length,text:text.slice(start)}
   if(fits([...segments,remaining])){segments.push(remaining);break}
   let low=start,high=text.length
   while(low<high){const mid=Math.ceil((low+high)/2);const item={paragraph,start,end:mid,text:text.slice(start,mid)};if(fits([...segments,item]))low=mid;else high=mid-1}
   let end=low
   if(end<=start){if(segments.length){flush();continue}end=Math.min(text.length,start+1)}
   // Prefer a word boundary; preserve every source character, including spaces.
   if(end<text.length&&end>start+1){const boundary=text.lastIndexOf(' ',end-1);if(boundary>start)end=boundary+1}
   segments.push({paragraph,start,end,text:text.slice(start,end)});start=end;flush()
  }
 }
 flush();return pages
}
export function pageForAnchor(pages,{paragraph=0,offset=0}={}){
 const index=pages.findIndex(page=>page.segments.some(s=>s.paragraph===paragraph&&s.start<=offset&&s.end>offset))
 return index>=0?index:Math.max(0,pages.length-1)
}
export function pageRange(page){
 if(!page?.segments.length)return null
 const first=page.segments[0],last=page.segments.at(-1)
 return {startParagraph:first.paragraph,startOffset:first.start,endParagraph:last.paragraph,endOffset:last.end}
}
