import {parentPort,workerData} from 'node:worker_threads';
import {runScript} from '../src/script.js';
try{const {source,bars,options}=workerData;const r=runScript(source,bars,{...options,maxOperations:1000000,maxCollectionElements:50000});parentPort.postMessage({result:{plots:r.plots.map(p=>({title:p.name,values:[...p.values].slice(-2)})),alerts:r.alerts,operations:r.operations,profile:r.profile}});}catch(e){parentPort.postMessage({error:String(e.message).slice(0,500)});}
