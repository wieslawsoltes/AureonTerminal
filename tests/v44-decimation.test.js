import test from 'node:test';
import assert from 'node:assert/strict';
import {visitLineEnvelope} from '../src/line-decimation.js';
const visit=(values,stride,breaks,first=0,last=values.length)=>{const out=[];visitLineEnvelope(values,first,last,stride,breaks,(index,move)=>out.push({index,move}));return out;};
test('v44 line envelope retains ordered endpoints and extrema',()=>{assert.deepEqual(visit([2,9,1,5,4],5),[{index:0,move:true},{index:1,move:false},{index:2,move:false},{index:4,move:false}]);});
test('v44 a NaN inside a LOD bucket never bridges finite samples',()=>{assert.deepEqual(visit([1,2,NaN,3,4],5),[{index:0,move:true},{index:1,move:false},{index:3,move:true},{index:4,move:false}]);});
test('v44 explicit session breaks split paths inside a single LOD bucket',()=>{assert.deepEqual(visit([1,2,3,4],4,[1,0,1,0]),[{index:0,move:true},{index:1,move:false},{index:2,move:true},{index:3,move:false}]);});
test('v44 finite runs join across bucket edges without an artificial gap',()=>{assert.deepEqual(visit([1,2,3,4],2),[{index:0,move:true},{index:1,move:false},{index:2,move:false},{index:3,move:false}]);});
test('v44 gaps at LOD bucket edges keep the new run disconnected',()=>{assert.deepEqual(visit([1,NaN,2,3],2),[{index:0,move:true},{index:2,move:true},{index:3,move:false}]);});
test('v44 empty and all-missing line arrays emit no geometry',()=>{assert.deepEqual(visit([],1),[]);assert.deepEqual(visit([NaN,Infinity,undefined],4),[]);});
test('v44 viewport clipping keeps first visible sample and tolerates shorter output',()=>{assert.deepEqual(visit([1,2,3,4],1,null,2,8),[{index:2,move:true},{index:3,move:false}]);});
test('v44 every emitted segment remains inside one known uninterrupted run',()=>{
  const values=Array.from({length:1000},(_,i)=>i%19===0?NaN:Math.sin(i)),breaks=values.map((_,i)=>i%37===0?1:0);
  for(const stride of[1,2,7,64,1000]){let prev=null;for(const p of visit(values,stride,breaks)){if(!p.move&&prev!==null)for(let i=prev+1;i<=p.index;i++)assert(Number.isFinite(values[i])&&!breaks[i]);prev=p.index;}}
});
test('v44 invalid decimation dimensions reject instead of nonprogressing loops',()=>{for(const s of [0,-1,.5,NaN,Infinity])assert.throws(()=>visit([1],s));});
