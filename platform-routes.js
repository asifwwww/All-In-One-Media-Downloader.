'use strict';
const {normalizeVideoURL,videoProblem}=require('./platforms');
const hasVideo=out=>!!out&&(out.formats?.some(f=>f.mediaType==='video')||out.items?.some(hasVideo));
function registerPlatformRoutes({app,extract,buildResponse,baseOf,limited}){
 for(const platform of ['instagram','youtube']){
  const handler=async(req,res)=>{
   if(limited('platform:'+platform+':'+req.ip,20,60000))return res.status(429).json({code:'rate_limited',error:'Too many requests. Please wait a minute.'});
   const url=normalizeVideoURL(req.body?.url,platform);
   if(!url)return res.status(400).json({code:'bad_url',platform,error:platform==='youtube'?'Paste a single YouTube watch, Shorts or youtu.be video link.':'Paste an Instagram reel or video-post link. Profile and story links are not supported.'});
   if(req.body.refresh!==undefined&&typeof req.body.refresh!=='boolean')return res.status(400).json({code:'bad_request',error:'refresh must be true or false.'});
   try{
    const result=await extract(url,{refresh:req.body.refresh===true});
    if(result.error){const code=result.error.code||'extraction_failed',status=['busy','setup'].includes(code)?503:code==='timeout'?504:['login_required','youtube_bot','blocked','restricted_media'].includes(code)?403:['protected_media','live_not_supported','no_video'].includes(code)?422:502;return res.status(status).json({platform,code,error:result.error.error||'This video could not be retrieved. Try another accessible video.'});}
    const problem=videoProblem(result.info);if(problem)return res.status(problem.status).json({platform,code:problem.code,error:problem.error});
    const out=buildResponse(result.info,baseOf(req),url);
    if(!hasVideo(out))return res.status(422).json({platform,code:'no_video',error:'No downloadable, unprotected video format was found. Image-only posts are not video downloads.'});
    return res.json({...out,platform,originalUrl:url});
   }catch{return res.status(502).json({platform,code:'extraction_failed',error:'Video lookup failed. Please retry later.'});}
  };app.post(['/api/'+platform,'/api/'+platform+'/download'],handler);
 }
}
module.exports={registerPlatformRoutes,hasVideo};
