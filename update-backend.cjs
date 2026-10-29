'use strict';

// Run from the root of the ORIGINAL TikSaveFast v5 backend.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const sha = text =>
  crypto.createHash('sha256').update(text).digest('hex');

const writes = new Map();

function read(name) {
  return fs
    .readFileSync(path.join(root, name), 'utf8')
    .replace(/\r\n/g, '\n');
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

for (const file of [
  'index.js',
  'extensions.js',
  'fast-providers.js',
  'media-response.js',
  'verified-media.js',
  'safe-fetch.js',
  'concurrency.js',
  'prepared-delivery.js',
  'provider-parser.js',
  'package.json'
]) {
  if (!fs.existsSync(path.join(root, file))) {
    stop(
      'Missing ' + file +
      '. Extract the COMPLETE original V5 backend, then run this updater inside it.'
    );
  }
}

function patch(name, beforeHash, afterHash, changes) {
  let text = read(name);

  if (sha(text) === afterHash) return;

  if (sha(text) !== beforeHash) {
    stop(
      name +
      ' differs from the supplied original V5. No files have been written. ' +
      'Use a fresh copy of your original ZIP.'
    );
  }

  for (const [oldText, newText] of changes) {
    const at = text.indexOf(oldText);

    if (at < 0 || text.indexOf(oldText, at + 1) !== -1) {
      stop(
        'Could not safely patch ' + name +
        '. No files have been written.'
      );
    }

    text =
      text.slice(0, at) +
      newText +
      text.slice(at + oldText.length);
  }

  if (sha(text) !== afterHash) {
    stop(
      'Output verification failed for ' + name +
      '. No files have been written.'
    );
  }

  writes.set(name, text);
}

patch(
  "index.js",
  "6370740a11e39961c087bac607e675c38ba686453f11befef7d776552ab23f57",
  "0d808c4c8444a3d046a5460d47c843ee903771b442a7795cf6c1113c945fdc1d",
  [
    [
      "const { boundedQueue, envInt } = require('./concurrency');\n",
      "const { boundedQueue, envInt } = require('./concurrency');\nconst { platformOf, normalizeVideoURL, videoProblem } = require('./platforms');\nconst { registerPlatformRoutes } = require('./platform-routes');\n"
    ],
    [
      "const COOKIES_FILE = path.join(os.tmpdir(), 'cookies-master.txt');\n",
      "const COOKIES_FILE = path.join(os.tmpdir(), 'cookies-master-'+crypto.randomBytes(8).toString('hex')+'.txt');\n"
    ],
    [
      "  try { fs.writeFileSync(COOKIES_FILE, Buffer.from(process.env.COOKIES_B64, 'base64')); HAS_COOKIES = true; } catch (e) { console.error('cookies:', e.message); }\n",
      "  try { fs.writeFileSync(COOKIES_FILE, Buffer.from(process.env.COOKIES_B64, 'base64'), {mode:0o600}); HAS_COOKIES = true; } catch (e) { console.error('cookies:', e.message); }\n"
    ],
    [
      "app.use(express.json({ limit: '10kb' }));\n",
      ""
    ],
    [
      "  next();\n});\n",
      "  next();\n});\n\napp.use(express.json({ limit: '10kb' }));\n"
    ],
    [
      "const HAS_FFMPEG = !_ff.error && _ff.status === 0;\n",
      "const HAS_FFMPEG = !_ff.error && _ff.status === 0;\nconst _deno=spawnSync('deno',['--version'],{timeout:5000});\nconst HAS_DENO=!_deno.error&&_deno.status===0;\n"
    ],
    [
      "    '--user-agent', UA, '--add-header', 'Accept-Language:en-US,en;q=0.9'];\n",
      "    '--ignore-config', '--no-cache-dir', '--user-agent', UA, '--add-header', 'Accept-Language:en-US,en;q=0.9'];\n  if (/youtube\\.com|youtu\\.be/i.test(url)) a.push('--js-runtimes', 'deno');\n"
    ],
    [
      "  if (/confirm you.re not a bot|Sign in to confirm/i.test(s)) return { code: 'youtube_bot', error: 'YouTube is blocking this server right now.', hint: 'Add COOKIES_B64 or YTDLP_PROXY on Render.' };\n  if (/login required|rate-limit reached|empty media response|Requested content is not available|checkpoint/i.test(s)) return { code: 'login_required', error: 'This platform requires a logged-in session for this link.', hint: 'Add COOKIES_B64 (Netscape cookies.txt) on Render.' };\n",
      "  if (/confirm you.re not a bot|Sign in to confirm/i.test(s)) return { code: 'youtube_bot', error: 'YouTube is blocking this server right now.', hint: 'Try again later. Platform login or access restrictions are not bypassed.' };\n  if (/login required|rate-limit reached|empty media response|Requested content is not available|checkpoint/i.test(s)) return { code: 'login_required', error: 'This platform requires a logged-in session for this link.', hint: 'Use an accessible link. These routes do not unlock private content.' };\n"
    ],
    [
      "  if (/403|Forbidden/i.test(s)) return { code: 'blocked', error: 'The platform blocked the request (HTTP 403).', hint: 'Update yt-dlp, add cookies or a proxy.' };\n",
      "  if (/403|Forbidden/i.test(s)) return { code: 'blocked', error: 'The platform blocked the request (HTTP 403).', hint: 'Check the extractor version and try again later; access restrictions are not bypassed.' };\n"
    ],
    [
      "  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !HOSTS.test(u.hostname)) return null;\n",
      "  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !HOSTS.test(u.hostname)) return null;\n  const platform=platformOf(u.toString());\n  if(platform)return normalizeVideoURL(u.toString(),platform);\n  if(/(^|\\.)(youtube\\.com|youtu\\.be|instagram\\.com)$/i.test(u.hostname))return null;\n"
    ],
    [
      "async function extract(url) {\n",
      "async function extract(url, {refresh=false}={}) {\n  if(refresh)cache.delete(url);\n"
    ],
    [
      "      try { const info = JSON.parse(r.out); cacheSet(url, info); return { info }; }\n",
      "      try { const info = JSON.parse(r.out); const problem=platformOf(url)?videoProblem(info):null;if(problem)return {error:{code:problem.code,error:problem.error}};cacheSet(url, info); return { info }; }\n"
    ],
    [
      "const baseOf = req => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;\n",
      "const PUBLIC_BASE_URL=process.env.PUBLIC_BASE_URL?new URL(process.env.PUBLIC_BASE_URL).origin:'';\nconst baseOf = req => PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;\n"
    ],
    [
      "ok: !!BIN, ytdlp: YTDLP_VERSION",
      "ok: !!BIN && HAS_FFMPEG && !_probe.error && _probe.status===0 && HAS_DENO, deno: HAS_DENO, platforms: {instagram: true, youtube: true}, ytdlp: YTDLP_VERSION"
    ],
    [
      "  if(req.body.refresh===true)cache.delete(url);\n  const r = await extract(url);\n",
      "  if(req.body.refresh!==undefined&&typeof req.body.refresh!=='boolean')return res.status(400).json({code:'bad_request',error:'refresh must be true or false.'});\n  const r = await extract(url,{refresh:req.body.refresh===true});\n"
    ],
    [
      "  if (r.error) return res.status(r.error.code==='busy'?503:502).json({error:r.error.error||'Extraction failed. Please retry.',code:r.error.code||'extraction_failed'});\n",
      "  if (r.error) return res.status(r.error.code==='busy'?503:502).json({error:r.error.error||'Extraction failed. Please retry.',code:r.error.code||'extraction_failed'});\n  const platform=platformOf(url);\n  if(platform){const problem=videoProblem(r.info);if(problem)return res.status(problem.status).json({platform,code:problem.code,error:problem.error});}\n"
    ],
    [
      "require('./extensions')({app, cleanUrl, extract, buildResponse, baseOf, register, streams, limited, safeName, safeFetch, HAS_FFMPEG, mergeSlot, baseArgs, withCookies, run});\n",
      "require('./extensions')({app, cleanUrl, extract, buildResponse, baseOf, register, streams, limited, safeName, safeFetch, HAS_FFMPEG, mergeSlot, baseArgs, withCookies, run});\nregisterPlatformRoutes({app,extract,buildResponse,baseOf,limited});\napp.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.type==='entity.parse.failed')return res.status(400).json({code:'bad_json',error:'Send a valid JSON body.'});if(err.type==='entity.too.large')return res.status(413).json({code:'body_too_large',error:'Request body is too large.'});console.error('request error:',err.message);return res.status(500).json({code:'server_error',error:'The request could not be processed.'});});\n"
    ]
  ]
);

patch(
  "media-response.js",
  "133eac90a432572245de5ae5e94c53f556d2aee6a7e59cde6a64f58be2e49e82",
  "be1b37d74ca9607c483e2279984f1266cdfa8bdc208c8239454be60ebb69a55d",
  [
    [
      "  const audio=all.filter(f=>mediaURL(f.url)&&f.vcodec==='none'&&f.acodec&&f.acodec!=='none').sort((a,b)=>(b.abr||0)-(a.abr||0))[0];\n",
      "  const audio=all.filter(f=>f.has_drm!==true&&f.format_id&&mediaURL(f.url)&&f.vcodec==='none'&&f.acodec&&f.acodec!=='none').sort((a,b)=>(b.abr||0)-(a.abr||0))[0];\n"
    ],
    [
      "   const plan={pageUrl,formatId:selector||String(f.format_id),mode:kind==='direct'?'direct':'prepare',outputExt:container,mediaType:type,expectedHeight:height,strictFormat:true};\n",
      "   const plan={pageUrl,formatId:selector||String(f.format_id),mode:kind==='direct'?'direct':'prepare',requireAudio:type==='video'?hasAudio!==false:undefined,outputExt:container,mediaType:type,expectedHeight:height,strictFormat:true};\n"
    ],
    [
      "  for(const f of all){\n",
      "  for(const f of all){\n   if(f.has_drm===true){omitted.push('protected media is not supported');continue;}\n"
    ]
  ]
);

patch(
  "verified-media.js",
  "1c497ed74c43e224f298172066f5d77eb9605894383284a456c63beb67fc8b81",
  "6cd38371ef0f1c5bc239fdd2e2ef23f3f428b0ff807d0f39182af8d61e0a614e",
  [
    [
      "if(s.mediaType==='video'&&!audio)",
      "if(s.mediaType==='video'&&s.requireAudio!==false&&!audio)"
    ],
    [
      "s.expectedHeight,s.mediaType])).digest",
      "s.expectedHeight,s.mediaType,s.requireAudio])).digest"
    ],
    [
      "s.mediaType==='video'?'video,audio':'audio'",
      "s.mediaType==='video'?(e.probe.streams.some(x=>x.codec_type==='audio')?'video,audio':'video'):'audio'"
    ]
  ]
);

writes.set("platforms.js", String.raw`'use strict';
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
`);

writes.set("platform-routes.js", String.raw`'use strict';
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
`);

writes.set("check-startup.js", String.raw`'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const required=['index.js','extensions.js','fast-providers.js','platforms.js','platform-routes.js','safe-fetch.js','concurrency.js','media-response.js','provider-parser.js','prepared-delivery.js','verified-media.js'];
const missing=required.filter(f=>!fs.existsSync(path.join(__dirname,f)));
if(missing.length){console.error('Incomplete backend deployment. Missing: '+missing.join(', ')+'. Commit the COMPLETE backend folder and redeploy. Do not create empty placeholder modules.');process.exit(1);}
if(process.argv.includes('--full'))for(const [bin,args]of [[process.env.YTDLP_BIN||'yt-dlp',['--version']],['ffmpeg',['-version']],['ffprobe',['-version']],['deno',['--version']]]){const r=spawnSync(bin,args,{timeout:15000,stdio:'ignore'});if(r.error||r.status!==0){console.error('Required tool unavailable: '+bin+'. Use the supplied Dockerfile.');process.exit(1);}}
console.log('Backend files verified; Instagram, YouTube and existing provider modules are present.');
`);

writes.set(
  "Dockerfile",
  "FROM node:22-bookworm-slim\n\n# python + ffmpeg (merging), deno (YouTube JS challenges), latest yt-dlp with EJS solver\nRUN apt-get update && apt-get install -y --no-install-recommends \\\n      git python3 python3-venv ffmpeg ca-certificates curl unzip \\\n    && rm -rf /var/lib/apt/lists/*\nRUN python3 -m venv /opt/venv \\\n && /opt/venv/bin/pip install --no-cache-dir -U pip \"yt-dlp[default]\" \\\n && /opt/venv/bin/pip install --no-cache-dir \"git+https://github.com/tribixbite/yt-dlp-threads.git\"\nRUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh\nENV PATH=\"/opt/venv/bin:/usr/local/bin:${PATH}\"\nRUN printf -- \"--js-runtimes deno\\n\" > /etc/yt-dlp.conf\n\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev --omit=optional\nCOPY . .\nRUN node check-startup.js --full\nENV NODE_ENV=production\nENV NO_UPDATE=1\nEXPOSE 10000\nCMD [\"npm\", \"start\"]\n"
);

writes.set("package.json", String.raw`{
  "name": "media-downloader-api",
  "version": "5.1.0",
  "main": "index.js",
  "engines": {
    "node": ">=22 <25"
  },
  "scripts": {
    "start": "node index.js",
    "test": "node --test test/*.test.js",
    "prestart": "node check-startup.js --full",
    "check": "node check-startup.js --full"
  },
  "dependencies": {
    "express": "^4.19.2",
    "ipaddr.js": "^2.2.0"
  },
  "optionalDependencies": {
    "yt-dlp-exec": "*"
  }
}
`);

writes.set(".dockerignore", String.raw`node_modules
.git
.env
.env.*
!.env.example
*.zip
*.log
coverage
reports
`);

// Back up every overwritten file before applying the prepared changes.
const backup = path.join(
  root,
  '.backend-update-backup-' + Date.now()
);

fs.mkdirSync(backup);

for (const [name, text] of writes) {
  const file = path.join(root, name);

  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(backup, name));
  }

  fs.writeFileSync(file, text);
}

const ignore = path.join(root, '.gitignore');
const oldIgnore = fs.existsSync(ignore)
  ? fs.readFileSync(ignore, 'utf8')
  : '';

if (fs.existsSync(ignore)) {
  fs.copyFileSync(ignore, path.join(backup, '.gitignore'));
}

fs.writeFileSync(
  ignore,
  oldIgnore +
  '\n.backend-update-backup-*/\nnode_modules/\n.env\n.env.*\n!.env.example\ncookies.txt\ncookies-*.txt\n'
);

console.log(
  'Updated ' + writes.size +
  ' backend files. Backup: ' + path.basename(backup)
);

console.log(
  'Next: npm install --package-lock-only --ignore-scripts --omit=optional'
);

console.log('Then: npm ci --omit=optional && npm test');

console.log(
  'Commit the changed files and lockfile. ' +
  'Deploy with Docker, not a Node-only runtime.'
);

console.log(
  'Set PUBLIC_BASE_URL and ALLOWED_ORIGINS ' +
  'to your actual deployment values.'
);
