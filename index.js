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

const PORT = process.env.PORT || 10000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const PROXY = process.env.YTDLP_PROXY || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HOSTS = /(^|\.)(tiktok\.com|instagram\.com|facebook\.com|fb\.watch|fb\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|reddit\.com|redd\.it|pinterest\.[a-z.]+|pin\.it|snapchat\.com|threads\.net|threads\.com|vimeo\.com)$/i;

// ---------- cookies (optional) ----------
const COOKIES_FILE = path.join(os.tmpdir(), 'cookies-master.txt');
let HAS_COOKIES = false;
if (process.env.COOKIES_B64) {
  try { fs.writeFileSync(COOKIES_FILE, Buffer.from(process.env.COOKIES_B64, 'base64')); HAS_COOKIES = true; } catch (e) { console.error('cookies:', e.message); }
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (ORIGINS.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (o && ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition');
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
function semaphore(n) {
  let active = 0; const q = [];
  const next = () => { if (active < n && q.length) { active++; q.shift()(); } };
  return fn => new Promise((resolve, reject) => {
    q.push(() => fn().then(resolve, reject).finally(() => { active--; next(); })); next();
  });
}
const extractSlot = semaphore(2);
const mergeSlot = semaphore(1);
const pipeSlot = semaphore(2);

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
const HAS_FFMPEG = !_ff.error && _ff.status === 0;
console.log('yt-dlp binary:', BIN || 'NOT FOUND', '| ffmpeg:', HAS_FFMPEG);

// ---------- yt-dlp runner ----------
function run(args, timeoutMs, cap = 20 * 1024 * 1024) {
  if (!BIN) return Promise.resolve({ code: -1, out: '', err: 'NO_YTDLP' });
  return new Promise(resolve => {
    const p = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const t = setTimeout(() => { if (!done) { err += '\nTIMEOUT'; p.kill('SIGKILL'); } }, timeoutMs);
    p.stdout.on('data', d => { if (out.length < cap) out += d; });
    p.stderr.on('data', d => { if (err.length < 20000) err += d; });
    p.on('error', e => { err += '\n' + e.message; });
    p.on('close', code => { done = true; clearTimeout(t); resolve({ code, out, err }); });
  });
}
function baseArgs(url) {
  const a = ['--no-playlist', '--no-warnings', '--no-check-certificates', '--socket-timeout', '20', '--extractor-retries', '2', '--retries', '3', '--fragment-retries', '3',
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
  if (/Unsupported URL/i.test(s)) return { code: 'unsupported', error: 'This link type is not supported.' };
  if (/private|unavailable|removed|not exist|404|deleted/i.test(s)) return { code: 'unavailable', error: 'This media is private, removed or unavailable.' };
  if (/403|Forbidden/i.test(s)) return { code: 'blocked', error: 'The platform blocked the request (HTTP 403).', hint: 'Update yt-dlp, add cookies or a proxy.' };
  return { code: 'failed', error: 'Failed to extract. Make sure the link is public and valid.' };
}

// ---------- url validation ----------
function cleanUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u; try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !HOSTS.test(u.hostname)) return null;
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
const isHttp = f => f && f.url && !/m3u8|dash|f4m|ism/i.test(f.protocol || '') && !/^(m3u8|mpd|f4m)$/i.test(f.ext || '');
const hasV = f => f.vcodec !== 'none', hasA = f => f.acodec !== 'none';
const isWatermarked = f => /watermark/i.test((f.format_note || '') + ' ' + (f.format_id || '')) || f.format_id === 'download';
const byQuality = (a, b) => (isWatermarked(a) - isWatermarked(b)) || ((b.height || 0) - (a.height || 0)) || ((b.tbr || 0) - (a.tbr || 0));

function buildResponse(info, base, pageUrl) {
  if (info.entries && info.entries.length) info = info.entries[0];
  const all = info.formats && info.formats.length ? info.formats
    : (info.url ? [{ url: info.url, ext: info.ext, vcodec: info.vcodec, acodec: info.acodec, protocol: info.protocol, http_headers: info.http_headers, height: info.height, format_id: info.format_id || 'single' }] : []);
  const title = info.title || info.description || 'Downloaded Media';
  const name = safeName(title);

  const mk = (f, dl, ext, mode) => {
    const id = register(f.url || '', f.http_headers || info.http_headers, name + '.' + (ext || f.ext || 'mp4'),
      { pageUrl, formatId: f.format_id, mode: mode || 'direct' });
    return `${base}/api/stream/${id}${dl ? '?dl=1' : ''}`;
  };
  const pick = (list, n) => { const seen = new Set(); const out = [];
    for (const f of list.sort(byQuality)) { const k = (isWatermarked(f) ? 'wm' : '') + (f.height || 0); if (seen.has(k)) continue; seen.add(k); out.push(f); if (out.length >= n) break; }
    return out; };

  const both = pick(all.filter(f => isHttp(f) && hasV(f) && hasA(f)), 6);          // video+audio in one file
  const vonly = pick(all.filter(f => isHttp(f) && hasV(f) && !hasA(f)), 1);         // video without sound (last resort, like the old code)
  const lab = f => (f.height ? f.height + 'p' : (f.format_note || 'HD')) + (isWatermarked(f) ? ' (watermark)' : '');
  const formats = both.map(f => ({ quality: lab(f), ext: f.ext || 'mp4', size: f.filesize || f.filesize_approx || 0, kind: 'direct', url: mk(f, true) }));

  // HD that exists only as separate video/audio (needs ffmpeg -> only when ffmpeg is installed)
  const bestH = both.filter(f => !isWatermarked(f)).reduce((m, f) => Math.max(m, f.height || 0), 0);
  const merges = HAS_FFMPEG && pageUrl ? [...new Set(all.filter(f => hasV(f) && f.height).map(f => f.height))]
    .filter(h => h > bestH && h <= 1080).sort((a, b) => b - a).slice(0, 2) : [];
  const mergeFormats = merges.map(h => ({ quality: h + 'p HD (merged, takes longer)', ext: 'mp4', size: 0, kind: 'merge',
    url: `${base}/api/merge?h=${h}&src=${encodeURIComponent(pageUrl)}` }));
  formats.push(...mergeFormats);

  if (!both.length && vonly.length) {
    formats.push({ quality: lab(vonly[0]) + ' (video only, no sound)', ext: vonly[0].ext || 'mp4', size: 0, kind: 'direct', url: mk(vonly[0], true) });
  }
  // Keep a server-side fallback available even when direct URLs are returned.
  // Some platforms issue short-lived URLs or block direct proxy requests.
  if (pageUrl) formats.push({ quality: 'Server fallback (best compatible file)', ext: 'mp4', size: 0, kind: 'pipe',
    url: `${base}/api/stream/${register('', {}, name + '.mp4', { pageUrl, formatId: 'b/bv*', mode: 'pipe' })}?dl=1` });

  const audios = all.filter(f => isHttp(f) && !hasV(f) && hasA(f)).sort((a, b) => (b.abr || 0) - (a.abr || 0));
  const aud = audios.find(f => /m4a|mp3|mp4/.test(f.ext || '')) || audios[0];

  const best = both[0] || vonly[0];
  const first = both[0] ? formats[0] : (mergeFormats[0] || formats.find(f => f.kind === 'pipe') || formats[0]);
  return {
    title,
    thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : ''),
    duration: info.duration_string || (info.duration ? Math.round(info.duration) + ' sec' : '-'),
    uploader: info.uploader || info.channel || info.creator || info.uploader_id || '-',
    view_count: info.view_count ? Number(info.view_count).toLocaleString('en-US') : '-',
    like_count: info.like_count || 0,
    source: info.extractor_key || info.extractor || '',
    videoUrl: best ? mk(best, false) : '',
    downloadUrl: first ? first.url : '',
    audioUrl: aud ? mk(aud, true, aud.ext === 'webm' ? 'webm' : 'm4a') : '',
    formats
  };
}

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
      const r = await run(c.args, 45000);
      if (r.code !== 0 || !r.out.trim()) return { error: explain(r.err), raw: r.err.slice(-400) };
      try { const info = JSON.parse(r.out); cacheSet(url, info); return { info }; }
      catch { return { error: explain('') }; }
    } finally { c.cleanup(); }
  }).finally(() => inflight.delete(url));
  inflight.set(url, job); return job;
}

const baseOf = req => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;

app.get('/', (req, res) => res.send('All-In-One Media Downloader API is running.'));
app.get('/health', (req, res) => res.json({ ok: !!BIN, ytdlp: YTDLP_VERSION, bin: BIN ? (BIN === 'yt-dlp' ? 'system' : 'yt-dlp-exec') : 'none', ffmpeg: HAS_FFMPEG, cookies: HAS_COOKIES, proxy: !!PROXY }));

app.post('/api/download', async (req, res) => {
  if (limited('d:' + req.ip, 20, 60000)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.', code: 'rate_limited' });
  const url = cleanUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'Please paste a valid link from a supported platform.', code: 'bad_url' });
  const r = await extract(url);
  if (r.error) { console.error('extract fail:', url, r.raw || ''); return res.status(502).json({ ...r.error, detail: (r.raw || '').trim().split('\n').slice(-2).join(' ').slice(0, 220) }); }
  try { return res.json(buildResponse(r.info, baseOf(req), url)); }
  catch (e) { console.error('build:', e.message); return res.status(500).json({ error: 'Could not process this media.', code: 'failed' }); }
});

const MIME = { mp4: 'video/mp4', webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', mov: 'video/quicktime' };
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
      if (!started && !res.headersSent) { console.error('pipe fail:', s.pageUrl, err.slice(-300)); res.status(502).send(explain(err).error); }
      else if (started && code !== 0) res.destroy();
      done();
    });
  }));
}

app.get('/api/stream/:id', async (req, res) => {
  const s = streams.get(req.params.id);
  if (!s) return res.status(410).send('Link expired. Fetch the video again.');
  if (s.mode === 'pipe' || !s.url) return pipeYtDlp(req, res, s);
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  try {
    const h = { ...s.headers }; if (req.headers.range) h.Range = req.headers.range;
    const up = await fetch(s.url, { headers: h, signal: ctrl.signal, redirect: 'follow' });
    if (!up.ok && up.status !== 206) throw new Error('upstream ' + up.status);
    res.status(up.status);
    res.setHeader('Content-Type', up.headers.get('content-type') || 'video/mp4');
    for (const k of ['content-length', 'content-range']) { const v = up.headers.get(k); if (v) res.setHeader(k, v); }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.dl) res.setHeader('Content-Disposition', dispo(s, req));
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    console.error('direct stream failed (' + e.message + ') -> yt-dlp pipe');
    if (s.pageUrl) return pipeYtDlp(req, res, { ...s, formatId: 'b/bv*', mode: 'pipe' });
    res.status(502).send('Download failed.');
  }
});

app.get('/api/merge', async (req, res) => {
  if (limited('m:' + req.ip, 4, 60000)) return res.status(429).send('Too many merge requests. Please wait.');
  const url = cleanUrl(req.query.src); const h = parseInt(req.query.h, 10);
  if (!url || !(h >= 144 && h <= 1080)) return res.status(400).send('Bad request');
  mergeSlot(async () => {
    const id = crypto.randomBytes(6).toString('hex'); const tmp = path.join(os.tmpdir(), 'm-' + id);
    const c = withCookies([...baseArgs(url), '-f', `bv*[height<=${h}]+ba/b[height<=${h}]/b`, '--merge-output-format', 'mp4',
      '--max-filesize', '200M', '-o', tmp + '.%(ext)s', url]);
    let file = '';
    try {
      const r = await run(c.args, 240000);
      file = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('m-' + id) && /\.(mp4|mkv|webm)$/.test(f)).map(f => path.join(os.tmpdir(), f))[0] || '';
      if (r.code !== 0 || !file) { if (!res.headersSent) res.status(502).send(explain(r.err).error); return; }
      const st = fs.statSync(file);
      res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Content-Length', st.size);
      res.setHeader('Content-Disposition', `attachment; filename="video-${h}p.mp4"`);
      await new Promise(done => { const rs = fs.createReadStream(file); rs.on('error', done); res.on('close', done); rs.on('end', done); rs.pipe(res); });
    } finally {
      c.cleanup();
      fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('m-' + id)).forEach(f => fs.unlink(path.join(os.tmpdir(), f), () => {}));
    }
  }).catch(() => { if (!res.headersSent) res.status(500).send('Merge failed.'); });
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
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  readVersion().catch(() => {});
  setTimeout(updateYtDlp, 3 * 60 * 1000).unref();   // update 3 min after boot (not during first requests)
  setInterval(updateYtDlp, 24 * 3600 * 1000).unref(); // and daily
});
