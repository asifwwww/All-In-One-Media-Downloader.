'use strict';
const YT=new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be']);
const IG=new Set(['instagram.com','www.instagram.com','m.instagram.com']);
function parse(raw){if(typeof raw!=='string'||raw.length>2000)return null;try{const u=new URL(raw.trim());return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u:null;}catch{return null;}}
function platformOf(raw){const u=parse(raw);return u?(YT.has(u.hostname)?'youtube':IG.has(u.hostname)?'instagram':null):null;}
function normalizeVideoURL(raw,platform){
 const u=parse(raw);if(!u)return null;
 if(platform==='youtube'){
  if(!YT.has(u.hostname))return null;let id;
  if(['youtu.be','www.youtu.be'].includes(u.hostname))id=u.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
  else if(/^\/watch\/?$/.test(u.pathname))id=u.searchParams.get('v');
  else id=u.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
  return id&&/^[A-Za-z0-9_-]{11}$/.test(id)?'https://www.youtube.com/watch?v='+id:null;
 }
 if(platform==='instagram'){
  if(!IG.has(u.hostname))return null;const m=u.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,64})\/?$/);
  return m?'https://www.instagram.com/'+(m[1]==='reels'?'reel':m[1])+'/'+m[2]+'/':null;
 }return null;
}
function nodes(i){return Array.isArray(i?.entries)?i.entries.filter(Boolean).flatMap(nodes):i?[i]:[];}
function videoProblem(info){
 const all=nodes(info);if(!all.length)return{status:422,code:'no_video',error:'No video was returned for this link.'};
 if(all.some(n=>n.has_drm===true))return{status:422,code:'protected_media',error:'Protected media is not supported.'};
 if(all.some(n=>['private','premium_only','subscriber_only','needs_auth'].includes(n.availability)))return{status:403,code:'restricted_media',error:'This video is restricted. Only accessible videos you are authorized to download are supported.'};
 if(all.some(n=>n.is_live===true||['is_live','is_upcoming','post_live'].includes(n.live_status)))return{status:422,code:'live_not_supported',error:'Live, upcoming or still-processing streams are not supported. Try a completed video.'};return null;
}
module.exports={platformOf,normalizeVideoURL,videoProblem};
