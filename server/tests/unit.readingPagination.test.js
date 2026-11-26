import test from 'node:test'
import assert from 'node:assert/strict'
import {paginateReading,pageForAnchor,pageRange} from '../../src/utils/readingPagination.js'

const paragraphs=['Alice was beginning to get very tired of sitting by her sister.  “What is the use of a book?” she thought.','A'.repeat(175),'Next paragraph, with punctuation—and words.']
const paginate=capacity=>paginateReading(paragraphs,items=>items.reduce((sum,s)=>sum+s.text.length,0)+Math.max(0,items.length-1)*2<=capacity)
test('responsive pagination preserves every source character and fits narrow, wide and oversized-word pages',()=>{
 for(const capacity of [1,37,80,210,1000]){
  const pages=paginate(capacity),segments=pages.flatMap(p=>p.segments)
  assert.ok(pages.length)
  for(let p=0;p<paragraphs.length;p++)assert.equal(segments.filter(s=>s.paragraph===p).map(s=>s.text).join(''),paragraphs[p])
  for(const page of pages){
   assert.ok(page.segments.reduce((sum,s)=>sum+s.text.length,0)+Math.max(0,page.segments.length-1)*2<=capacity)
   const r=pageRange(page)
   assert.equal(paragraphs.slice(r.startParagraph,r.endParagraph+1).map((s,i)=>s.slice(i===0?r.startOffset:0,i===r.endParagraph-r.startParagraph?r.endOffset:s.length)).join('\n\n'),page.segments.map(s=>s.text).join('\n\n'))
  }
 }
 assert.deepEqual(paginateReading([],()=>true),[])
 assert.equal(pageRange(null),null)
})
test('saved paragraph and offset resolve to the same source position after phone/desktop reflow',()=>{
 const anchor={paragraph:1,offset:119}
 for(const capacity of [37,80,210]){
  const pages=paginate(capacity),index=pageForAnchor(pages,anchor)
  assert.ok(pages[index].segments.some(s=>s.paragraph===1&&s.start<=119&&s.end>119))
  const start=pages[index].segments[0]
  assert.equal(pageForAnchor(pages,{paragraph:start.paragraph,offset:start.start}),index)
 }
})
