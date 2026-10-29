'use strict';
const normalize=require('./provider-parser');
const {mediaURL,identity}=require('./media-response');
const {boundedQueue,envInt}=require('./concurrency');
const mimeExt={'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','audio/mpeg':'mp3','audio/mp4':'m4a','audio/webm':'webm','audio/ogg':'ogg','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
module.exports=function({safeFetch,register,safeName}){
 const memo=new Map(),pending=new Map(),verifySlot=boundedQueue(6,{maxQueued:160,queueTimeoutMs:45000}),slot=boundedQueue(envInt('FAST_API_CONCURRENCY',4,1,12),{maxQueued:20,queueTimeoutMs:8000});
 async function json(url,opts={}){const r=await safeFetch(url,{...opts,signal:AbortSignal.timeout(envInt('FAST_API_TIMEOUT_MS',18000,1000,60000))});if(!r.ok)throw Error('Provider unavailable');const reader=r.body.getReader(),parts=[];let length=0;try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2097152)throw Error('Response too large');parts.push(Buffer.from(value));}return JSON.parse(Buffer.concat(parts).toString('utf8'));}finally{await reader.cancel().catch(()=>{});}}
 async function probe(url,type){
  const opts={headers:{Referer:'https://www.tiktok.com/'},signal:AbortSignal.timeout(envInt('FAST_VERIFY_TIMEOUT_MS',6000,1000,15000))};let r=await safeFetch(url,{...opts,method:'HEAD'});
  if([403,405,501].includes(r.status)){await r.body?.cancel();r=await safeFetch(url,{...opts,method:'GET',headers:{...opts.headers,Range:'bytes=0-0'}});}
  try{const mime=(r.headers.get('content-type')||'').split(';')[0].toLowerCase();if(!r.ok||/text\/|application\/(json|xml)/.test(mime)||!(mime.startsWith(type+'/')||mime==='application/octet-stream'))throw Error('Unusable media response');
   const total=r.status===206?Number((r.headers.get('content-range')||'').match(/\/(\d+)$/)?.[1]):Number(r.headers.get('content-length'));return {ext:mimeExt[mime]||null,size:Number.isSafeInteger(total)&&total>0&&!r.headers.get('content-encoding')?total:0};
  }finally{await r.body?.cancel();}
 }
 async function provider(url,source,base,all=false){
  const key=source+':'+url;const old=memo.get(key);if(old&&old.exp>Date.now())return expose(all?await old.value.complete:old.value,base);
  if(pending.has(key)){const v=await pending.get(key);return expose(all?await v.complete:v,base);}
  const work=slot(async()=>{
   let raw,d;
   if(source==='primary'){raw=await json('https://tikwm.com/api/?hd=1&url='+encodeURIComponent(url));if(raw.code!==0)throw Error('Provider unavailable');d=raw.data;}
   else{if(!process.env.RAPIDAPI_KEY)throw Error('Secondary provider is not configured');raw=await json('https://tiktok-downloader-without-watermark-api-download-tiktok-videos.p.rapidapi.com/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','X-RapidAPI-Key':process.env.RAPIDAPI_KEY,'X-RapidAPI-Host':'tiktok-downloader-without-watermark-api-download-tiktok-videos.p.rapidapi.com'},body:new URLSearchParams({URL:url})});d=normalize(raw);}
   if(!d||typeof d!=='object')throw Error('Invalid response');
   const abs=u=>typeof u!=='string'?'':u.startsWith('//')?'https:'+u:u.startsWith('/')?(source==='primary'?'https://tikwm.com'+u:''):u;
   const candidates=[];for(const field of ['hdplay','play','wmplay','music']){const u=mediaURL(abs(d[field]));if(u)candidates.push({url:u,field,mediaType:field==='music'?'audio':'video',watermark:field==='wmplay'?true:undefined});}
   for(const [index,v]of(Array.isArray(d.images)?d.images:[]).slice(0,50).entries()){const u=mediaURL(abs(v));if(u)candidates.push({url:u,field:'image',index,mediaType:'image'});}
   const uniq=[...new Map(candidates.map(c=>[c.mediaType+':'+c.url,c])).values()];if(!uniq.length)throw Error('No valid media URLs');
   // Resolve at the first verified media file; finish the remaining probes independently.
   const usable=[];const probes=uniq.map(c=>verifySlot(async()=>{
     const verified={...c,...await probe(c.url,c.mediaType),verified:true};
     const rawLink=Array.isArray(raw.links)?raw.links.find(l=>l.url===c.url):null;
     const h=typeof rawLink?.quality==='string'?rawLink.quality.match(/(?:^|\s)(\d{3,5})p\b/i):null;if(h)verified.height=Number(h[1]);
     usable.push(verified);return verified;
   }));
   const complete=Promise.allSettled(probes);const first=await Promise.any(probes);
   const meta={original_url:url};if(typeof d.title==='string'&&d.title)meta.title=d.title;if(typeof d.author?.nickname==='string'&&d.author.nickname)meta.author=d.author.nickname;if(typeof d.author?.unique_id==='string'&&d.author.unique_id)meta.username=d.author.unique_id;if(Number.isFinite(d.duration)&&d.duration>=0)meta.duration_seconds=d.duration;if(mediaURL(abs(d.cover)))meta.thumbnail=abs(d.cover);
   const value={candidates:[first],metadata:meta};value.complete=complete.then(()=>({candidates:usable,metadata:meta}));memo.set(key,{value,exp:Date.now()+120000});if(memo.size>150)memo.delete(memo.keys().next().value);return value;
  }).finally(()=>pending.delete(key));pending.set(key,work);const v=await work;return expose(all?await v.complete:v,base);
 }
 function expose(value,base){const data={title:value.metadata.title||'',author:{nickname:value.metadata.author||'',unique_id:value.metadata.username||''},duration:value.metadata.duration_seconds,cover:value.metadata.thumbnail||'',images:[]};
  const formats=value.candidates.slice().sort((a,b)=>a.field==='image'&&b.field==='image'?a.index-b.index:['hdplay','play','wmplay','music','image'].indexOf(a.field)-['hdplay','play','wmplay','music','image'].indexOf(b.field)).map(c=>{const id=register(c.url,{Referer:'https://www.tiktok.com/'},safeName(value.metadata.title||'media')+(c.ext?'.'+c.ext:'.bin'),{mediaType:c.mediaType,strictFormat:true});const url=base+'/api/stream/'+id+'?dl=1';if(c.field==='image')data.images.push(url);else data[c.field]=url;return {url,quality:c.height?c.height+'p':c.mediaType==='image'?'Original image':c.mediaType==='audio'?'Audio':'Resolution unavailable',height:c.height||null,ext:c.ext,size:c.size,sizeKind:c.size?'exact':'unknown',mediaType:c.mediaType,watermark:c.watermark??null,sourceFingerprint:identity(c.url),kind:'direct',variant:c.field,verified:true,hasAudio:c.mediaType==='audio'?true:null};});
  return {code:0,data,metadata:value.metadata,formats};
 }
 return {invalidate:(url,provider)=>{for(const p of provider?[provider]:['primary','secondary'])memo.delete(p+':'+url);},provider,quick:(url,base)=>Promise.any([provider(url,'primary',base),provider(url,'secondary',base)])};
};
