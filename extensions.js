'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
module.exports=({app,cleanUrl,extract,buildResponse,baseOf,register,streams,limited,safeName,safeFetch,HAS_FFMPEG,mergeSlot,baseArgs,withCookies,run})=>{
  const fast=require('./fast-providers')({safeFetch,register,safeName});
  function tikUrl(raw){const u=cleanUrl(raw);return u&&/(^|\.)tiktok\.com$/i.test(new URL(u).hostname)?u:null;}
  const gate=(req,res,max=35)=>{if(limited('ext:'+req.ip,max,60000)){res.status(429).json({error:'Too many requests. Please wait a minute.',code:'rate_limited'});return false}return true;};
  app.post('/api/tiktok/quick',async(req,res)=>{
    if(!gate(req,res))return;const url=tikUrl(req.body?.url);if(!url)return res.status(400).json({error:'Paste a public TikTok link.',code:'bad_url'});
    const provider=req.body?.provider;
    if(provider!==undefined&&!['primary','secondary'].includes(provider))return res.status(400).json({error:'Invalid provider selection.'});
    if(req.body.refresh===true)fast.invalidate(url,provider);
    try{const out=provider?await fast.provider(url,provider,baseOf(req),req.body.all===true):await fast.quick(url,baseOf(req));res.json(out);}
    catch{res.status(502).json({error:'A quick download is not available. The independent quality lookup may still succeed.',code:'quick_unavailable'});}
  });
  // Backwards-compatible route: never acts as an arbitrary client-controlled media URL proxy.
  app.get('/api/tiktok/file',async(req,res)=>{
    if(!gate(req,res))return;const url=tikUrl(req.query.src);if(!url)return res.status(400).json({error:'Invalid TikTok link.'});
    const kind=req.query.kind||'video';if(!['image','audio','video'].includes(kind))return res.status(400).json({error:'Invalid media type.'});
    try{const resolved=await Promise.allSettled(['primary','secondary'].map(p=>fast.provider(url,p,baseOf(req),true)));const formats=resolved.filter(r=>r.status==='fulfilled').flatMap(r=>r.value.formats);if(!formats.length)throw Error('Unavailable');let candidates=formats.filter(f=>f.mediaType===kind);if(req.query.variant==='standard')candidates.sort((a,b)=>Number(b.variant==='play')-Number(a.variant==='play'));const index=kind==='image'?Number(req.query.index||0):0;if(!Number.isInteger(index)||index<0||!candidates[index])return res.status(404).json({error:'Requested media is unavailable.'});return res.redirect(302,candidates[index].url);}
    catch{const r=await extract(url);if(r.error)return res.status(502).json({error:'The download is unavailable. Please refresh the options.'});const out=buildResponse(r.info,baseOf(req),url),f=(out.formats||[]).find(f=>f.mediaType===kind);if(!f)return res.status(404).json({error:'Requested media is unavailable.'});res.redirect(302,f.url);}
  });
  app.post('/api/transcript',async(req,res)=>{
    if(!gate(req,res))return;const url=cleanUrl(req.body?.url);if(!url)return res.status(400).json({error:'Invalid platform URL.'});
    try{
      const r=await extract(url);if(r.error)return res.status(502).json(r.error);
      const info=r.info.entries?.[0]||r.info;
      const languages={...info.automatic_captions,...info.subtitles};const language=String(req.body.language||'');
      const entries=Object.entries(languages);const entry=entries.find(([l])=>l===language)||entries.find(([l])=>/^en\b/.test(l))||entries[0];
      if(!entry)return res.status(422).json({error:'No accessible captions were found. Speech-to-text generation is not configured.',code:'no_captions'});
      const track=entry[1].find(t=>t.ext==='vtt')||entry[1].find(t=>t.ext==='srt')||entry[1].find(t=>t.ext==='json3');
      if(!track)return res.status(422).json({error:'No supported caption format available.',code:'no_captions'});
      const upstream=await safeFetch(track.url,{headers:info.http_headers,signal:AbortSignal.timeout(18000)});if(!upstream.ok)throw Error('Captions unavailable');
      const reader=upstream.body.getReader();let count=0;const parts=[];while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>2*1024*1024){await reader.cancel();throw Error('Caption file too large')}parts.push(Buffer.from(value));}
      const raw=Buffer.concat(parts).toString('utf8');let lines;
      if(track.ext==='json3')lines=JSON.parse(raw).events?.map(e=>(e.segs||[]).map(s=>s.utf8||'').join(''))||[];
      else lines=raw.replace(/\r/g,'').split('\n').filter(l=>l.trim()&&!/^WEBVTT|^NOTE|^Kind:|^Language:|^\d+$/.test(l)&&!l.includes('-->')).map(l=>l.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
      const text=lines.filter((l,i)=>l.trim()&&l!==lines[i-1]).join('\n').trim();if(!text)throw Error('No readable captions');
      res.json({text,language:entry[0],languages:entries.map(([l])=>l),source:'captions',title:info.title||'Transcript'});
    }catch{res.status(502).json({error:'Could not retrieve captions. Try a different public video.'});}
  });
  // Actual MP3 conversion, not a renamed M4A file.
  app.head('/api/audio',(req,res)=>{if(!cleanUrl(req.query.src))return res.status(400).end();if(!HAS_FFMPEG)return res.status(503).end();res.setHeader('X-Download-Status','requires-processing');res.status(200).end();});
  app.get('/api/audio',async(req,res)=>{
    if(!gate(req,res,4))return;const url=cleanUrl(req.query.src);if(!url)return res.status(400).send('Invalid URL');if(!HAS_FFMPEG)return res.status(503).send('Audio conversion is not configured');
    mergeSlot(async()=>{
      const prefix='a-'+crypto.randomBytes(8).toString('hex'),tmp=path.join(os.tmpdir(),prefix);
      const c=withCookies([...baseArgs(url),'-f','ba/b','-x','--audio-format','mp3','--audio-quality','2','--max-filesize',process.env.MAX_MEDIA_FILESIZE||'200M','-o',tmp+'.%(ext)s',url]);
      try{const r=await run(c.args,240000);const file=tmp+'.mp3';if(r.code!==0||!fs.existsSync(file))return res.status(502).send('Audio conversion failed. Please retry.');await require('./verified-media').verify(file,{mediaType:'audio'});res.download(file,'TikSaveFast-audio.mp3',()=>{fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith(prefix)).forEach(f=>fs.unlink(path.join(os.tmpdir(),f),()=>{}));});}
      finally{c.cleanup();setTimeout(()=>{fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith(prefix)).forEach(f=>fs.unlink(path.join(os.tmpdir(),f),()=>{}));},600000).unref();}
    }).catch(()=>{if(!res.headersSent)res.status(500).send('Conversion failed');});
  });
};
