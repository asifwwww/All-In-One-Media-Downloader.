
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

module.exports = ({
  app,
  cleanUrl,
  extract,
  buildResponse,
  baseOf,
  register,
  streams,
  limited,
  safeName,
  safeFetch,
  HAS_FFMPEG,
  mergeSlot,
  baseArgs,
  withCookies,
  run
}) => {
  // Fixed module filename to match fast-provider.js
  const fast = require('./fast-provider')({
    safeFetch,
    register,
    safeName
  });

  function tikUrl(raw) {
    const u = cleanUrl(raw);

    return u &&
      /(^|\.)tiktok\.com$/i.test(new URL(u).hostname)
      ? u
      : null;
  }

  const gate = (req, res, max = 35) => {
    if (limited('ext:' + req.ip, max, 60000)) {
      res.status(429).json({
        error: 'Too many requests. Please wait a minute.',
        code: 'rate_limited'
      });

      return false;
    }

    return true;
  };

  // Fast TikTok API endpoint
  app.post('/api/tiktok/quick', async (req, res) => {
    if (!gate(req, res)) return;

    const url = tikUrl(req.body?.url);

    if (!url) {
      return res.status(400).json({
        error: 'Paste a public TikTok link.',
        code: 'bad_url'
      });
    }

    const provider = req.body?.provider;

    if (
      provider !== undefined &&
      !['primary', 'secondary'].includes(provider)
    ) {
      return res.status(400).json({
        error: 'Invalid provider selection.'
      });
    }

    if (req.body.refresh === true) {
      fast.invalidate(url, provider);
    }

    try {
      const out = provider
        ? await fast.provider(
            url,
            provider,
            baseOf(req),
            req.body.all === true
          )
        : await fast.quick(url, baseOf(req));

      return res.json(out);
    } catch {
      return res.status(502).json({
        error:
          'A quick download is not available. The independent quality lookup may still succeed.',
        code: 'quick_unavailable'
      });
    }
  });

  // Backwards-compatible TikTok file route
  app.get('/api/tiktok/file', async (req, res) => {
    if (!gate(req, res)) return;

    const url = tikUrl(req.query.src);

    if (!url) {
      return res.status(400).json({
        error: 'Invalid TikTok link.'
      });
    }

    const kind = req.query.kind || 'video';

    if (!['image', 'audio', 'video'].includes(kind)) {
      return res.status(400).json({
        error: 'Invalid media type.'
      });
    }

    try {
      const resolved = await Promise.allSettled(
        ['primary', 'secondary'].map(provider =>
          fast.provider(provider === 'primary' ? url : url, provider, baseOf(req), true)
        )
      );

      const formats = resolved
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value.formats || []);

      if (!formats.length) {
        throw new Error('Unavailable');
      }

      let candidates = formats.filter(
        format => format.mediaType === kind
      );

      if (req.query.variant === 'standard') {
        candidates.sort(
          (a, b) =>
            Number(b.variant === 'play') -
            Number(a.variant === 'play')
        );
      }

      const index =
        kind === 'image'
          ? Number(req.query.index || 0)
          : 0;

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        !candidates[index]
      ) {
        return res.status(404).json({
          error: 'Requested media is unavailable.'
        });
      }

      return res.redirect(302, candidates[index].url);
    } catch {
      try {
        const result = await extract(url);

        if (result.error) {
          return res.status(502).json({
            error: 'The download is unavailable. Please refresh the options.'
          });
        }

        const out = buildResponse(
          result.info,
          baseOf(req),
          url
        );

        const format = (out.formats || []).find(
          item => item.mediaType === kind
        );

        if (!format) {
          return res.status(404).json({
            error: 'Requested media is unavailable.'
          });
        }

        return res.redirect(302, format.url);
      } catch {
        if (!res.headersSent) {
          return res.status(502).json({
            error: 'The download is unavailable. Please retry.'
          });
        }
      }
    }
  });

  // Transcript extraction from available captions
  app.post('/api/transcript', async (req, res) => {
    if (!gate(req, res)) return;

    const url = cleanUrl(req.body?.url);

    if (!url) {
      return res.status(400).json({
        error: 'Invalid platform URL.'
      });
    }

    try {
      const result = await extract(url);

      if (result.error) {
        return res.status(502).json(result.error);
      }

      const info = result.info.entries?.[0] || result.info;

      const languages = {
        ...info.automatic_captions,
        ...info.subtitles
      };

      const language = String(req.body.language || '');
      const entries = Object.entries(languages);

      const entry =
        entries.find(([key]) => key === language) ||
        entries.find(([key]) => /^en\b/.test(key)) ||
        entries[0];

      if (!entry) {
        return res.status(422).json({
          error:
            'No accessible captions were found. Speech-to-text generation is not configured.',
          code: 'no_captions'
        });
      }

      const tracks = entry[1] || [];

      const track =
        tracks.find(item => item.ext === 'vtt') ||
        tracks.find(item => item.ext === 'srt') ||
        tracks.find(item => item.ext === 'json3');

      if (!track) {
        return res.status(422).json({
          error: 'No supported caption format available.',
          code: 'no_captions'
        });
      }

      const upstream = await safeFetch(track.url, {
        headers: info.http_headers,
        signal: AbortSignal.timeout(18000)
      });

      if (!upstream.ok) {
        throw new Error('Captions unavailable');
      }

      const reader = upstream.body.getReader();
      let count = 0;
      const parts = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        count += value.length;

        if (count > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Caption file too large');
        }

        parts.push(Buffer.from(value));
      }

      const raw = Buffer.concat(parts).toString('utf8');
      let lines;

      if (track.ext === 'json3') {
        lines =
          JSON.parse(raw).events?.map(event =>
            (event.segs || [])
              .map(segment => segment.utf8 || '')
              .join('')
          ) || [];
      } else {
        lines = raw
          .replace(/\r/g, '')
          .split('\n')
          .filter(
            line =>
              line.trim() &&
              !/^WEBVTT|^NOTE|^Kind:|^Language:|^\d+$/.test(line) &&
              !line.includes('-->')
          )
          .map(line =>
            line
              .replace(/<[^>]*>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
          );
      }

      const text = lines
        .filter((line, index) =>
          line.trim() && line !== lines[index - 1]
        )
        .join('\n')
        .trim();

      if (!text) {
        throw new Error('No readable captions');
      }

      return res.json({
        text,
        language: entry[0],
        languages: entries.map(([key]) => key),
        source: 'captions',
        title: info.title || 'Transcript'
      });
    } catch {
      return res.status(502).json({
        error:
          'Could not retrieve captions. Try a different public video.'
      });
    }
  });

  // MP3 conversion availability check
  app.head('/api/audio', (req, res) => {
    if (!cleanUrl(req.query.src)) {
      return res.status(400).end();
    }

    if (!HAS_FFMPEG) {
      return res.status(503).end();
    }

    res.setHeader(
      'X-Download-Status',
      'requires-processing'
    );

    return res.status(200).end();
  });

  // Actual MP3 conversion
  app.get('/api/audio', async (req, res) => {
    if (!gate(req, res, 4)) return;

    const url = cleanUrl(req.query.src);

    if (!url) {
      return res.status(400).send('Invalid URL');
    }

    if (!HAS_FFMPEG) {
      return res.status(503).send(
        'Audio conversion is not configured'
      );
    }

    try {
      await mergeSlot(async () => {
        const prefix =
          'a-' + crypto.randomBytes(8).toString('hex');

        const tmp = path.join(os.tmpdir(), prefix);

        const command = withCookies([
          ...baseArgs(url),
          '-f',
          'ba/b',
          '-x',
          '--audio-format',
          'mp3',
          '--audio-quality',
          '2',
          '--max-filesize',
          process.env.MAX_MEDIA_FILESIZE || '200M',
          '-o',
          tmp + '.%(ext)s',
          url
        ]);

        try {
          const result = await run(
            command.args,
            240000
          );

          const file = tmp + '.mp3';

          if (
            result.code !== 0 ||
            !fs.existsSync(file)
          ) {
            return res.status(502).send(
              'Audio conversion failed. Please retry.'
            );
          }

          return res.download(
            file,
            'TikSaveFast-audio.mp3',
            () => {
              fs.readdirSync(os.tmpdir())
                .filter(name => name.startsWith(prefix))
                .forEach(name => {
                  fs.unlink(
                    path.join(os.tmpdir(), name),
                    () => {}
                  );
                });
            }
          );
        } finally {
          command.cleanup();

          setTimeout(() => {
            fs.readdirSync(os.tmpdir())
              .filter(name => name.startsWith(prefix))
              .forEach(name => {
                fs.unlink(
                  path.join(os.tmpdir(), name),
                  () => {}
                );
              });
          }, 600000).unref();
        }
      });
    } catch {
      if (!res.headersSent) {
        return res.status(500).send(
          'Conversion failed'
        );
      }
    }
  });
};
