'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const required=['index.js','extensions.js','fast-providers.js','platforms.js','platform-routes.js','safe-fetch.js','concurrency.js','media-response.js','provider-parser.js','prepared-delivery.js','verified-media.js'];
const missing=required.filter(f=>!fs.existsSync(path.join(__dirname,f)));
if(missing.length){console.error('Incomplete backend deployment. Missing: '+missing.join(', ')+'. Commit the COMPLETE backend folder and redeploy. Do not create empty placeholder modules.');process.exit(1);}
if(process.argv.includes('--full'))for(const [bin,args]of [[process.env.YTDLP_BIN||'yt-dlp',['--version']],['ffmpeg',['-version']],['ffprobe',['-version']],['deno',['--version']]]){const r=spawnSync(bin,args,{timeout:15000,stdio:'ignore'});if(r.error||r.status!==0){console.error('Required tool unavailable: '+bin+'. Use the supplied Dockerfile.');process.exit(1);}}
console.log('Backend files verified; Instagram, YouTube and existing provider modules are present.');
