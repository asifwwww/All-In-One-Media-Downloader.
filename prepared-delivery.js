'use strict';
const {envInt}=require('./concurrency');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
module.exports=function({mergeSlot,baseArgs,withCookies,run,explain}){
 return async(req,res,s)=>{
  try{await mergeSlot(async()=>{
   if(req.destroyed||res.destroyed)return;
   const prefix='prepared-'+crypto.randomBytes(10).toString('hex'),template=path.join(os.tmpdir(),prefix+'.%(ext)s'),ext=s.outputExt;
   const args=[...baseArgs(s.pageUrl),'-f',s.formatId,'--no-progress','--max-filesize',process.env.MAX_MEDIA_FILESIZE||'200M','-o',template];
   if(ext)args.push('--merge-output-format',ext,'--remux-video',ext);args.push(s.pageUrl);
   const c=withCookies(args),ctrl=new AbortController();res.once('close',()=>ctrl.abort());
   try{
    const r=await run(c.args,envInt('PREPARE_TIMEOUT_MS',240000,1000,600000),20*1024*1024,ctrl.signal);
    if(res.destroyed)return;
    const files=fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith(prefix+'.')&&!/\.part$|\.ytdl$/.test(f));const name=files.find(f=>ext&&f.endsWith('.'+ext))||files.find(f=>/\.(mp4|mkv|webm|m4a|mp3|ogg|opus|aac|mov)$/.test(f));
    if(r.code!==0||!name)return res.status(502).json({error:'This format could not be prepared. Refresh the options or choose another available format.',code:'format_unavailable'});
    const file=path.join(os.tmpdir(),name);if(!fs.statSync(file).size)return res.status(502).json({error:'The media file was empty.',code:'empty_media'});
    await new Promise(resolve=>res.download(file,s.name.replace(/\.[^.]+$/,'')+path.extname(file),()=>resolve()));
   }finally{c.cleanup();for(const f of fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith(prefix)))fs.unlink(path.join(os.tmpdir(),f),()=>{});}
  });}catch{if(!res.headersSent&&!res.destroyed)res.status(503).json({error:'The processing queue is busy or timed out. Please retry.',code:'busy'});}
 };
};
