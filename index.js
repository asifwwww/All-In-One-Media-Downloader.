'use strict';
/**
 * All-In-One Media Downloader API  (Render + Docker + yt-dlp)
 *  POST /api/download   { url }            -> details + download links (fast, cached)
 *  GET  /api/stream/:id ?dl=1&name=        -> proxies a media URL with the right headers (fixes TikTok 403)
 *  GET  /api/merge      ?src=<url>&h=1080  -> yt-dlp+ffmpeg merge for HD when no direct file exists
 *  GET  /health
 */
const express = require('express');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { safeFetch } = require('./safe-fetch');
const { boundedQueue, envInt } = require('./concurrency');

const PORT = process.env.PORT || 10000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://tiksavefast.com,https://www.tiksavefast.com').split(',').map(s => s.trim()).filter(Boolean);
const PROXY = process.env.YTDLP_PROXY || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HOSTS = /(^|\.)(tiktok\.com|instagram\.com|facebook\.com|fb\.watch|fb\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|reddit\.com|redd\.it|pinterest\.(com|co\.uk|ca|fr|de|es|it|com\.au|jp|co\.kr|ch|at|pt|se|dk|nl|ru|nz|com\.mx|com\.br)|pin\.it|snapchat\.com|threads\.net|threads\.com|vimeo\.com)$/i;

// ---------- cookies (optional) ----------
const COOKIES_FILE = path.join(os.tmpdir(), 'cookies-master.txt');
let HAS_COOKIES = false;
if (process.env.COOKIES_B64) {
  try { fs.writeFileSync(COOKIES_FILE, Buffer.from(process.env.COOKIES_B64, 'base64')); HAS_COOKIES = true; } catch (e) { console.error('cookies:', e.message); }
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (ORIGINS.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (o && ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition, X-Download-Status, X-Media-Verified');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- tiny rate limiter ----------
const hits = new Map();
function limited(ip, max, windowMs) {
  const now = Date.now(); const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(ip, arr); return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 120000)) hits.delete(k); }, 60000).unref();

// ---------- concurrency (free instance = 0.1 CPU) ----------
const extractSlot=boundedQueue(envInt('EXTRACT_CONCURRENCY',2,1,8),{maxQueued:20,queueTimeoutMs:15000});
const mergeSlot=boundedQueue(1,{maxQueued:8,queueTimeoutMs:20000});
const pipeSlot=boundedQueue(2,{maxQueued:12,queueTimeoutMs:15000});

// ---------- yt-dlp binary discovery (system yt-dlp, else yt-dlp-exec's copy) ----------
function findBin() {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN;
  const t = spawnSync('yt-dlp', ['--version'], { timeout: 20000 });
  if (!t.error && t.status === 0) return 'yt-dlp';
  try { const p = require('yt-dlp-exec/src/constants').YOUTUBE_DL_PATH; if (p && fs.existsSync(p)) return p; } catch (e) {}
  const g = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
  return fs.existsSync(g) ? g : '';
}
const BIN = findBin();
const _ff = spawnSync('ffmpeg', ['-version'], { timeout: 8000 });
const _probe=spawnSync('ffprobe',['-version'],{timeout:5000});
const HAS_FFMPEG = !_ff.error && _ff.status === 0;
console.log('yt-dlp binary:', BIN || 'NOT FOUND', '| ffmpeg:', HAS_FFMPEG);

// ---------- yt-dlp runner ----------
function run(args, timeoutMs, cap = 20 * 1024 * 1024, signal) {
  if (!BIN) return Promise.resolve({ code: -1, out: '', err: 'NO_YTDLP' });
  return new Promise(resolve => {
    const p = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform!=='win32' });
    let out = '', err = '', done = false;
    const abort=()=>{try{if(process.platform!=='win32')process.kill(-p.pid,'SIGKILL');else p.kill('SIGKILL');}catch{}};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const t = setTimeout(() => { if (!done) { err += '\nTIMEOUT'; abort(); } }, timeoutMs);
    p.stdout.on('data', d => { if(out.length+d.length>cap){err+='\nOUTPUT_LIMIT';abort();}else out+=d; });
    p.stderr.on('data', d => { if (err.length < 20000) err += d; });
    p.on('error', e => { err += '\n' + e.message; });
    p.on('close', code => { done = true; clearTimeout(t); signal?.removeEventListener('abort',abort); resolve({ code, out, err }); });
  });
}
function baseArgs(url) {
  const a = ['--no-playlist', '--playlist-end', '20', '--no-warnings', '--socket-timeout', '20', '--extractor-retries', '2', '--retries', '3', '--fragment-retries', '3',
    '--user-agent', UA, '--add-header', 'Accept-Language:en-US,en;q=0.9'];
  if (/vimeo\.com/i.test(url)) a.push('--referer', 'https://vimeo.com/');
  if (PROXY) a.push('--proxy', PROXY);
  return a;
}
function withCookies(args) {
  if (!HAS_COOKIES) return { args, cleanup() {} };
  const f = path.join(os.tmpdir(), 'c-' + crypto.randomBytes(6).toString('hex') + '.txt');
  try { fs.copyFileSync(COOKIES_FILE, f); } catch (e) { return { args, cleanup() {} }; }
  return { args: [...args, '--cookies', f], cleanup() { fs.unlink(f, () => {}); } };
}
function explain(stderr) {
  const s = stderr || '';
  if (/NO_YTDLP/.test(s)) return { code: 'setup', error: 'Server setup problem: yt-dlp is not installed on the server.', hint: 'Deploy with the Dockerfile (Render runtime: Docker) or add yt-dlp-exec.' };
  if (/TIMEOUT/.test(s)) return { code: 'timeout', error: 'The source took too long to respond. Please try again.' };
  if (/confirm you.re not a bot|Sign in to confirm/i.test(s)) return { code: 'youtube_bot', error: 'YouTube is blocking this server right now.', hint: 'Add COOKIES_B64 or YTDLP_PROXY on Render.' };
  if (/login required|rate-limit reached|empty media response|Requested content is not available|checkpoint/i.test(s)) return { code: 'login_required', error: 'This platform requires a logged-in session for this link.', hint: 'Add COOKIES_B64 (Netscape cookies.txt) on Render.' };
  if (/Unsupported URL/i.test(s)) {
    if (/threads\.(com|net)/i.test(s)) return { code: 'threads_unsupported', error: 'Threads link could not be extracted by the server.', hint: 'Make sure the latest Docker deployment completed and the Threads yt-dlp plugin loaded. Only public video posts are supported; text/image-only posts cannot be downloaded.' };
    return { code: 'unsupported', error: 'This link type is not supported by the current extractor.' };
  }
  if (/private|unavailable|removed|not exist|404|deleted/i.test(s)) return { code: 'unavailable', error: 'This media is private, removed or unavailable.' };
  if (/403|Forbidden/i.test(s)) return { code: 'blocked', error: 'The platform blocked the request (HTTP 403).', hint: 'Update yt-dlp, add cookies or a proxy.' };
  return { code: 'failed', error: 'Failed to extract. Make sure the link is public and valid.' };
}

// ---------- url validation ----------
function cleanUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u; try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !HOSTS.test(u.hostname)) return null;
  return u.toString();
}

// ---------- stream registry (id -> upstream url + headers) ----------
const streams = new Map();
function register(url, headers, name, extra) {
  const id = crypto.randomBytes(12).toString('hex');
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) if (!/^(host|content-length|connection|range|accept-encoding)$/i.test(k)) h[k] = String(v);
  if (!Object.keys(h).some(k => k.toLowerCase() === 'user-agent')) h['User-Agent'] = UA;
  streams.set(id, { url, headers: h, name, exp: Date.now() + 45 * 60 * 1000, ...(extra || {}) });
  if (streams.size > 3000) streams.delete(streams.keys().next().value);
  return id;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of streams) if (v.exp < now) streams.delete(k); }, 60000).unref();

// ---------- build response from yt-dlp JSON ----------
const safeName = s => (String(s || 'media').replace(/[\\/:*?"<>|\r\n#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'media');
const buildResponse=require('./media-response').makeBuilder({register,HAS_FFMPEG,safeName});

// ---------- cache + in-flight de-dupe ----------
const cache = new Map(); const inflight = new Map();
function cacheGet(k) { const c = cache.get(k); if (c && c.exp > Date.now()) return c.info; cache.delete(k); return null; }
function cacheSet(k, info) { cache.set(k, { info, exp: Date.now() + 10 * 60 * 1000 }); if (cache.size > 150) cache.delete(cache.keys().next().value); }

async function extract(url) {
  const hit = cacheGet(url); if (hit) return { info: hit };
  if (inflight.has(url)) return inflight.get(url);
  const job = extractSlot(async () => {
    const c = withCookies([...baseArgs(url), '-J', '--skip-download', url]);
    try {
      const r = await run(c.args, envInt('EXTRACTION_TIMEOUT_MS',45000,1000,180000));
      if (r.code !== 0 || !r.out.trim()) return { error: explain(r.err), raw: r.err.slice(-400) };
      try { const info = JSON.parse(r.out); cacheSet(url, info); return { info }; }
      catch { return { error: explain('') }; }
    } finally { c.cleanup(); }
  }).catch(()=>({error:{error:'Extraction queue busy or timed out. Please retry.',code:'busy'}})).finally(() => inflight.delete(url));
  inflight.set(url, job); return job;
}

const baseOf = req => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;

app.get('/', (req, res) => res.send('All-In-One Media Downloader API is running.'));
app.get('/health', (req, res) => res.json({ ok: !!BIN, ytdlp: YTDLP_VERSION, bin: BIN ? (BIN === 'yt-dlp' ? 'system' : 'yt-dlp-exec') : 'none', ffmpeg: HAS_FFMPEG, ffprobe: !_probe.error && _probe.status===0, cookies: HAS_COOKIES, proxy: !!PROXY, threadsPlugin: true, note: 'threadsPlugin indicates the Docker image is configured to install the Threads extractor; verify Render build logs if Threads still fails.' }));

app.post('/api/download', async (req, res) => {
  if (limited('d:' + req.ip, 20, 60000)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.', code: 'rate_limited' });
  const url = cleanUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'Please paste a valid link from a supported platform.', code: 'bad_url' });
  if(req.body.refresh===true)cache.delete(url);
  const r = await extract(url);
  if (r.error) return res.status(r.error.code==='busy'?503:502).json({error:r.error.error||'Extraction failed. Please retry.',code:r.error.code||'extraction_failed'});
  try { return res.json(buildResponse(r.info, baseOf(req), url)); }
  catch (e) { console.error('build:', e.message); return res.status(500).json({ error: 'Could not process this media.', code: 'failed' }); }
});

const MIME = { mp4:'video/mp4', webm:'video/webm', m4a:'audio/mp4', mp3:'audio/mpeg', mov:'video/quicktime', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', vtt:'text/vtt', srt:'application/x-subrip', json3:'application/json' };
function dispo(s, req) {
  const n = (req.query.name ? safeName(req.query.name) + path.extname(s.name) : s.name);
  return `attachment; filename="${n.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}
// Let yt-dlp itself fetch the media (same cookies/headers it used while extracting) and pipe it to the client.
function pipeYtDlp(req, res, s) {
  return pipeSlot(() => new Promise(resolve => {
    if (!BIN) { if (!res.headersSent) res.status(502).send('Server setup problem: yt-dlp missing.'); return resolve(); }
    // Re-extract from the original page at download time. Cached metadata can
    // contain expired signed media URLs and cause the fallback to fail too.
    const args = [...baseArgs(s.pageUrl), '-f', s.formatId || 'b/bv*', '-q', '--no-progress', '-o', '-', s.pageUrl];
    const c = withCookies(args);
    const p = spawn(BIN, c.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let started = false, err = '';
    const done = () => { clearTimeout(kill); c.cleanup(); resolve(); };
    const kill = setTimeout(() => p.kill('SIGKILL'), 10 * 60 * 1000);
    res.on('close', () => p.kill('SIGKILL'));
    p.stderr.on('data', d => { if (err.length < 4000) err += d; });
    p.stdout.once('data', first => {
      started = true;
      res.status(200);
      res.setHeader('Content-Type', MIME[(path.extname(s.name) || '').slice(1)] || 'video/mp4');
      res.setHeader('Cache-Control', 'no-store');
      if (req.query.dl) res.setHeader('Content-Disposition', dispo(s, req));
      res.write(first); p.stdout.pipe(res);
    });
    p.on('error', () => {});
    p.on('close', code => {
      if (!started && !res.headersSent) { res.status(502).json({error:'This format is no longer available. Refresh the download options.',code:'format_unavailable'}); }
      else if (started && code !== 0) res.destroy();
      done();
    });
  })).catch(()=>{if(!res.headersSent)res.status(503).json({error:"Download processing is busy. Please retry."});});
}

const servePrepared=require('./prepared-delivery')({mergeSlot,baseArgs,withCookies,run,safeFetch});
app.head('/api/stream/:id',async(req,res)=>{
 if(limited('head:'+req.ip,180,60000))return res.status(429).end();
 const s=streams.get(req.params.id);if(!s||s.exp<Date.now())return res.status(410).end();
 if(s.mode==='prepare'||s.mode==='pipe'||s.mediaType==='video'){res.setHeader('X-Download-Status','requires-processing');return res.status(200).end();}
 try{let up=await safeFetch(s.url,{method:'HEAD',headers:s.headers,signal:AbortSignal.timeout(12000)});
 if([403,405,501].includes(up.status)){up=await safeFetch(s.url,{headers:{...s.headers,Range:'bytes=0-0'},signal:AbortSignal.timeout(12000)});}
 if(!up.ok||(s.mediaType!=='caption'&&/text\/html|application\/json/i.test(up.headers.get('content-type')||''))){await up.body?.cancel();return res.status(up.status===404?404:502).end();}
 for(const k of ['content-type','content-length']){const v=up.headers.get(k);if(v&&!(k==='content-length'&&(up.status===206||up.headers.get('content-encoding'))))res.setHeader(k,v);}
 await up.body?.cancel();return res.status(200).end();
 }catch{return res.status(502).end();}
});

app.get('/api/stream/:id', async (req, res) => {
  if (limited('s:' + req.ip, 90, 60000)) return res.status(429).send('Too many stream requests. Please wait.');
  const s = streams.get(req.params.id);
  if (!s || s.exp < Date.now()) return res.status(410).send('Link expired. Fetch the video again.');
  if (s.mode === 'pipe' || !s.url) return pipeYtDlp(req, res, s);
  if(s.mode==='prepare'||s.mediaType==='video')return servePrepared(req,res,s);
  const ctrl = new AbortController();
  const deadline=setTimeout(()=>ctrl.abort(),envInt('MEDIA_STREAM_TIMEOUT_MS',300000,1000,600000));
  res.on('close', () => {clearTimeout(deadline);ctrl.abort()});
  try {
    const h = { ...s.headers }; if (req.headers.range) h.Range = req.headers.range;
    const up = await safeFetch(s.url, { headers: h, signal: ctrl.signal, redirect: 'follow' });
    if (!up.ok && up.status !== 206) throw new Error('upstream ' + up.status);
    if(s.mediaType!=='caption'&&/text\/html|application\/json/i.test(up.headers.get('content-type')||'')){await up.body?.cancel();throw Error('Not a media response');}
    res.status(up.status);
    res.setHeader('Content-Type', up.headers.get('content-type') || 'video/mp4');
    for (const k of ['content-length', 'content-range']) { const v = up.headers.get(k); if (v && !(k === 'content-length' && up.headers.get('content-encoding'))) res.setHeader(k, v); }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.dl) {
      const type=(up.headers.get('content-type')||'').split(';')[0].toLowerCase();
      const ext=Object.keys(MIME).find(k=>MIME[k]===type);
      const actual=ext ? {...s,name:s.name.replace(/\.[a-z0-9]+$/i,'')+'.'+ext} : s;
      res.setHeader('Content-Disposition', dispo(actual, req));
    }
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    // Do not silently substitute another resolution for an advertised format.
    if (s.pageUrl && s.formatId && !s.strictFormat) return pipeYtDlp(req, res, { ...s, mode: 'pipe' });
    res.status(502).json({error:'This download is unavailable or expired. Refresh the options and retry.',code:'download_unavailable'});
  }
});

app.get('/api/merge',async(req,res)=>{
 if(limited('m:'+req.ip,4,60000))return res.status(429).json({error:'Too many processing requests. Please wait.'});
 const url=cleanUrl(req.query.src),height=Number(req.query.h);if(!url||!Number.isInteger(height)||height<1||height>16384)return res.status(400).json({error:'Invalid requested resolution.'});
 const r=await extract(url);if(r.error)return res.status(502).json({error:'Could not refresh available formats.'});
 const data=buildResponse(r.info,baseOf(req),url);const f=(data.formats||[]).find(f=>f.height===height&&f.hasAudio===true&&f.mediaType==='video');
 if(!f)return res.status(404).json({error:'The requested resolution is not available.',code:'format_unavailable'});
 return res.redirect(302,f.url);
});

// ---------- yt-dlp version + auto update ----------
let YTDLP_VERSION = '';
async function readVersion() { const r = await run(['--version'], 15000); YTDLP_VERSION = r.out.trim(); }
function updateYtDlp() {
  if (!BIN || process.env.NO_UPDATE) return;
  const p = BIN === 'yt-dlp' ? spawn('pip', ['install', '-U', '--no-cache-dir', 'yt-dlp[default]'], { stdio: 'ignore' })
                              : spawn(BIN, ['-U'], { stdio: 'ignore' });
  p.on('close', () => readVersion().catch(() => {})); p.on('error', () => {});
}
require('./extensions')({app, cleanUrl, extract, buildResponse, baseOf, register, streams, limited, safeName, safeFetch, HAS_FFMPEG, mergeSlot, baseArgs, withCookies, run});

if (require.main === module) app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  readVersion().catch(() => {});
  setTimeout(updateYtDlp, 3 * 60 * 1000).unref();   // update 3 min after boot (not during first requests)
  setInterval(updateYtDlp, 24 * 3600 * 1000).unref(); // and daily
});

module.exports = { app, buildResponse, cleanUrl };
