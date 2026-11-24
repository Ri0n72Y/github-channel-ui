import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutMasonry, masonryColumns } from '../plugins/topic-page/src/masonry.mjs'

const keys = n => Array.from({ length:n },(_,i)=>'repo-'+(i+1))

test('#83 actual measured 323/369 heights pack by shortest column, not grid rows',()=>{
 const heights=[323,369,390,405,420,...Array(7).fill(250)]
 const result=layoutMasonry({keys:keys(12),heights,width:1288})
 assert.equal(result.columns,5)
 assert.equal(result.assignments[5],0)
 assert.equal(result.positions[5].top,336)
 assert.ok(result.positions[5].top < 369)
 assert.equal(result.positions[5].left,result.positions[0].left)
})
test('#83 incremental append preserves old keys, columns and positions',()=>{
 const first=layoutMasonry({keys:keys(7),heights:[240,300,280,290,260,330,345],width:1288})
 const next=layoutMasonry({keys:keys(12),heights:[240,300,280,290,260,330,345,275,315,350,300,255],width:1288,previous:first})
 assert.deepEqual(next.assignments.slice(0,7),first.assignments)
 assert.deepEqual(next.positions.slice(0,7),first.positions)
 assert.equal(new Set(next.keys).size,12)
})
test('#83 image load / failure reflows y but never jumps an already visible key to another column',()=>{
 const old=layoutMasonry({keys:keys(10),heights:[220,270,240,230,200,160,160,160,160,160],width:1288})
 const changed=layoutMasonry({keys:keys(10),heights:[380,270,240,230,200,160,160,160,160,160],width:1288,previous:old})
 assert.deepEqual(changed.assignments,old.assignments)
 assert.ok(changed.positions[5].top>=old.positions[5].top)
})
test('#83 responsive columns 5/4/3/2/1 reflow on CSS viewport width',()=>{
 assert.deepEqual([1288,950,716,520,347,292].map(masonryColumns),[5,4,3,2,1,1])
 const desktop=layoutMasonry({keys:keys(10),heights:Array(10).fill(210),width:1288})
 const tablet=layoutMasonry({keys:keys(10),heights:Array(10).fill(210),width:716,previous:desktop})
 assert.equal(tablet.columns,3)
 assert.equal(tablet.assignments[3],0)
 const mobile=layoutMasonry({keys:keys(10),heights:Array(10).fill(210),width:347,previous:tablet})
 assert.equal(mobile.columns,1)
 assert.equal(mobile.positions[9].top,9*223)
})
test('#83 measured positions do not overlap and height contains final cards',()=>{
 const heights=[323,369,290,350,270,310,230,440,380,250,300,370]
 const result=layoutMasonry({keys:keys(12),heights,width:1288})
 for(let i=0;i<result.positions.length;i++)for(let j=0;j<i;j++){
  if(result.assignments[i]!==result.assignments[j])continue
  const earlier=result.positions[j],later=result.positions[i]
  assert.ok(later.top>=earlier.top+heights[j]+13-0.01)
 }
 const last=Math.max(...result.positions.map((p,i)=>p.top+heights[i]))
 assert.equal(result.height,last)
})
test('#83 empty and rejected layout never makes up measurements',()=>{
 assert.equal(layoutMasonry({keys:[],heights:[],width:700}).height,0)
 assert.throws(()=>layoutMasonry({keys:keys(2),heights:[30],width:700}),RangeError)
 assert.throws(()=>layoutMasonry({keys:keys(1),heights:[30],width:0}),RangeError)
})
