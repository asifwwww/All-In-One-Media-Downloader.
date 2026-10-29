'use strict';
const crypto=require('crypto');
const imageExt=/^(jpe?g|png|webp|gif|heic|avif)$/i;
const containers=new Set(['mp4','webm','mkv','mov','m4v','mp3','m4a','aac','ogg','opus','wav','flac','jpg','jpeg','png','webp','gif','heic','avif']);
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:null;
function mediaURL(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname))return '';return u.href;}catch{return '';}}
function identity(url){return crypto.createHash('sha256').update(url).digest('hex');}
function metadata(info,pageUrl){
 const out={};const mapping={id:'id',title:'title',description:'description',uploader:'author',uploader_id:'username',channel:'channel',channel_id:'channel_id',uploader_url:'author_url',thumbnail:'thumbnail',duration:'duration_seconds',timestamp:'timestamp',upload_date:'upload_date',view_count:'view_count',like_count:'like_count',comment_count:'comment_count',repost_count:'repost_count',language:'language',availability:'availability',age_limit:'age_limit',tags:'tags',categories:'categories',width:'width',height:'height',fps:'fps',resolution:'resolution'};
 for(const [key,target]of Object.entries(mapping)){const v=info[key];if(v!==undefined&&v!==null&&v!==''&&(typeof v==='string'||typeof v==='number'||(Array.isArray(v)&&v.every(x=>typeof x==='string'))))out[target]=v;}
 if(!out.author&&typeof info.creator==='string')out.author=info.creator;
 if(!out.thumbnail&&Array.isArray(info.thumbnails)){const t=info.thumbnails.filter(t=>mediaURL(t.url)).at(-1);if(t)out.thumbnail=t.url;}
 if(out.thumbnail&&!mediaURL(out.thumbnail))delete out.thumbnail;
 if(mediaURL(pageUrl))out.original_url=pageUrl;if(mediaURL(info.webpage_url))out.webpage_url=info.webpage_url;
 return out;
}
function makeBuilder({register,HAS_FFMPEG,safeName}){
 function build(info,base,pageUrl){
  if(Array.isArray(info.entries)){
   const entries=info.entries.filter(Boolean),items=entries.slice(0,20).map(e=>build(e,base,e.webpage_url||pageUrl));
   return {title:info.title||'',metadata:metadata(info,pageUrl),items,formats:[],collectionLimit:20,extraction:{state:'partial',inventoryComplete:false,scope:'returned collection entries',reason:'Collection discovery is limited to 20 entries.'}};
  }
  const meta=metadata(info,pageUrl),all=Array.isArray(info.formats)&&info.formats.length?info.formats:info.url?[{...info,format_id:info.format_id||'single'}]:[];
  const output=[],omitted=[],seen=new Map();const title=info.title||info.description||'';const name=safeName(title||'media');
  const audio=all.filter(f=>mediaURL(f.url)&&f.vcodec==='none'&&f.acodec&&f.acodec!=='none').sort((a,b)=>(b.abr||0)-(a.abr||0))[0];
  function add(f,{type,selector,kind='direct',ext=f.ext,hasAudio,quality,sourceFingerprint,watermark}={}){
   const upstream=mediaURL(f.url);if(!upstream||(!f.format_id&&kind!=='direct')){omitted.push('unsupported or unidentifiable source format');return;}
   const container=containers.has(String(ext||'').toLowerCase())?String(ext).toLowerCase():null;
   const height=positive(f.height),width=positive(f.width),bitrate=type==='audio'?positive(f.abr):positive(f.tbr),fps=positive(f.fps);
   const q=quality||(type==='image'?'Original image':type==='audio'?(positive(f.abr)?Math.round(f.abr)+' kbps':'Audio'):(height?height+'p':'Resolution unavailable'));
   const equivalent=[type,width||'',height||'',container||'',hasAudio===true?'sound':hasAudio===false?'silent':'unknown',watermark===true?'marked':watermark===false?'clean':'unknown',fps||'',type==='audio'?Math.round(bitrate||0):'',(height||type==='image')?'':identity(upstream)].join('|');
   const sf=sourceFingerprint||identity(upstream);
   const size=kind==='direct'?positive(f.filesize)||positive(f.filesize_approx):null,sizeKind=kind==='direct'?(positive(f.filesize)?'exact':positive(f.filesize_approx)?'estimated':'unknown'):'unknown';
   const entry={quality:q,ext:container,size:size||0,sizeKind,kind,mediaType:type,width,height,fps,hasAudio,watermark:typeof watermark==='boolean'?watermark:null,sourceFingerprint:sf,equivalenceKey:equivalent,formatId:String(f.format_id||'source-'+identity(upstream).slice(0,12)),bitrate:bitrate||null};
   const prior=seen.get(equivalent);if(prior&&((prior.bitrate||0)>=(entry.bitrate||0)))return;
   const plan={pageUrl,formatId:selector||String(f.format_id),mode:kind==='direct'?'direct':'prepare',outputExt:container,mediaType:type,strictFormat:true};
   const id=register(upstream,f.http_headers||info.http_headers,name+(container?'.'+container:'.bin'),plan);entry.url=base+'/api/stream/'+id+'?dl=1';
   if(prior)output.splice(output.indexOf(prior),1);seen.set(equivalent,entry);output.push(entry);
  }
  for(const f of all){
   if(!mediaURL(f.url)){omitted.push('non-HTTPS or missing media URL');continue;}
   const ext=String(f.ext||'').toLowerCase(),img=imageExt.test(ext),v=!img&&f.vcodec!=='none'&&(!!f.vcodec||positive(f.height)||positive(f.width)),a=!img&&f.acodec!=='none'&&!!f.acodec;
   const direct=!/m3u8|dash|f4m|ism/i.test(f.protocol||'')&&!/^(m3u8|mpd|f4m)$/.test(ext);
   const note=f.format_note||'';const watermark=/(?:no|without)[ _-]*watermark/i.test(note)?false:/watermark/i.test(note)?true:undefined;
   if(img){add(f,{type:'image',hasAudio:false,watermark});continue;}
   if(!v&&!a){omitted.push('source does not identify media codecs or dimensions');continue;}
   if(direct)add(f,{type:v?'video':'audio',hasAudio:v?(a?true:f.acodec==='none'?false:undefined):true,watermark});
   else if(HAS_FFMPEG)add(f,{type:v?'video':'audio',kind:'prepared',ext:containers.has(ext)?ext:(v?'mp4':'m4a'),hasAudio:a,watermark});
   else omitted.push('stream format requires unavailable processing tools');
   if(v&&f.acodec==='none'&&audio&&HAS_FFMPEG){const mergedExt=ext==='webm'&&audio.ext==='webm'?'webm':'mp4';add(f,{type:'video',kind:'merge',selector:String(f.format_id)+'+'+String(audio.format_id),ext:mergedExt,hasAudio:true,watermark,sourceFingerprint:identity(f.url+'\n'+audio.url)});}
  }
  output.sort((a,b)=>({video:0,audio:1,image:2}[a.mediaType]-{video:0,audio:1,image:2}[b.mediaType])||(b.height||0)-(a.height||0)||Number(b.hasAudio)-Number(a.hasAudio)||(b.bitrate||0)-(a.bitrate||0));
  const captions=Object.entries({...info.automatic_captions,...info.subtitles}).map(([language,tracks])=>({language,tracks:(Array.isArray(tracks)?tracks:[]).filter(t=>mediaURL(t.url)&&/^(vtt|srt|json3)$/.test(t.ext||'')).map(t=>({ext:t.ext,url:base+'/api/stream/'+register(t.url,info.http_headers,name+'.'+t.ext,{mediaType:'caption'})+'?dl=1'}))})).filter(t=>t.tracks.length);
  const best=output.find(f=>f.mediaType==='video'&&f.hasAudio!==false)||output.find(f=>f.mediaType==='video'),aud=output.find(f=>f.mediaType==='audio');
  const partial=omitted.length>0||info.is_live===true||info._type==='url'||info._type==='url_transparent';
  const extraction={state:partial?'partial':'complete',inventoryComplete:!partial,scope:'all identifiable formats returned by the current extractor',sourceFormatCount:all.length,returnedFormatCount:output.length,omittedFormatCount:omitted.length};
  if(partial)extraction.reason='Some returned source formats could not be prepared or the source is incomplete.';
  return {title,thumbnail:meta.thumbnail||'',duration:typeof info.duration==='number'?Math.round(info.duration)+' sec':info.duration_string||'',uploader:meta.author||'',view_count:info.view_count??null,like_count:info.like_count??null,source:info.extractor_key||info.extractor||'',metadata:meta,videoUrl:best?.url||'',downloadUrl:best?.url||output[0]?.url||'',audioUrl:aud?.url||'',formats:output,captions,capabilities:{audio:output.some(f=>f.hasAudio===true),captions:captions.length>0},conversions:HAS_FFMPEG&&pageUrl&&output.some(f=>f.hasAudio===true)?[{mediaType:'audio',ext:'mp3',size:0,sizeKind:'unknown',quality:'Audio',kind:'conversion',url:base+'/api/audio?src='+encodeURIComponent(pageUrl),equivalenceKey:'audio|mp3|conversion'}]:[],extraction};
 }
 return build;
}
module.exports={makeBuilder,mediaURL,identity,metadata};
