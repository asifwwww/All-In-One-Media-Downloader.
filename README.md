# All-In-One Media Downloader API (Render + Docker + yt-dlp)

## Quick check
Open `/health`. `"bin":"system"` (Docker) or `"bin":"yt-dlp-exec"` (Node) and a version number = OK. `"bin":"none"` = yt-dlp missing.

## Deploy (one time)
1. In your GitHub repo replace `index.js`, `package.json`, `render.yaml` with these files and add `Dockerfile` + `.dockerignore`. Delete `package-lock.json` if it exists.
2. Render → New → Web Service → pick the repo → Language/Runtime: **Docker** → Instance: Free → Create.
   (An existing Node service cannot be switched to Docker; create a new one, then delete the old one.)
3. After the build, open `https://YOUR-SERVICE.onrender.com/health` → should show `{"ok":true,"ytdlp":"2026...."}`.
4. Keep it awake (no cold start): cron-job.org or UptimeRobot → GET `/health` every 10 minutes.

## Optional environment variables (Render → Environment)
- `ALLOWED_ORIGINS` = `https://tiksavefast.com,https://www.tiksavefast.com`  (default `*`)
- `COOKIES_B64` = base64 of a Netscape `cookies.txt` (Instagram / Threads / YouTube). Use a spare account.
  On a PC: `base64 -w0 cookies.txt`  -> paste the output. Cookies expire; refresh when Instagram stops working.
- `YTDLP_PROXY` = `http://user:pass@host:port` (a residential proxy is the only reliable fix if YouTube blocks Render's IP)

## API
- `POST /api/download` body `{ "url": "..." }` -> `{ title, thumbnail, duration, uploader, view_count, source, videoUrl, downloadUrl, audioUrl, formats:[{quality,ext,size,kind,url}] }`
- On failure: HTTP 4xx/5xx with `{ error, code, hint? }` (`youtube_bot`, `login_required`, `unavailable`, `unsupported`, `timeout`, `blocked`, `rate_limited`)
- `kind:"merge"` formats (HD for YouTube etc.) take longer: the server downloads + merges first, then sends the file.


## Platform compatibility notes (v2.4)
- The Docker image installs the community `yt-dlp-threads` extractor plugin so public Threads video share links can be parsed. This is third-party, best-effort support and may break when Threads changes its page markup. Public video posts only; private, login-gated, image-only, and text-only posts are not supported.
- YouTube blocking is a server-side restriction, not a URL-validation bug. If Render logs say YouTube is blocking the server, configure a valid, current Netscape-format `COOKIES_B64` secret or an appropriate `YTDLP_PROXY`, then redeploy. Cookies are sensitive credentials; use a dedicated account/session and keep the secret private. Neither cookies nor a proxy guarantees access.
- Instagram and Reddit may require a public post and, in some cases, a valid session. Vimeo may be private, region-restricted, or protected. Test with public, non-DRM posts first and check Render logs for the exact extractor error.
