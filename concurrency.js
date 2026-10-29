'use strict';
function boundedQueue(limit,{maxQueued=20,queueTimeoutMs=15000}={}){
 let active=0;const waiting=[];
 function pump(){while(active<limit&&waiting.length){const item=waiting.shift();clearTimeout(item.timer);active++;Promise.resolve().then(item.fn).then(item.resolve,item.reject).finally(()=>{active--;pump()});}}
 return fn=>new Promise((resolve,reject)=>{if(waiting.length>=maxQueued){return reject(Object.assign(Error('Server is busy. Please retry shortly.'),{code:'busy'}));}const item={fn,resolve,reject};item.timer=setTimeout(()=>{const at=waiting.indexOf(item);if(at>=0){waiting.splice(at,1);reject(Object.assign(Error('The server queue timed out. Please retry.'),{code:'queue_timeout'}));}},queueTimeoutMs);waiting.push(item);pump();});
}
const envInt=(key,fallback,min=1,max=600000)=>{const n=Number(process.env[key]);return Number.isFinite(n)&&n>=min&&n<=max?Math.floor(n):fallback};
module.exports={boundedQueue,envInt};
