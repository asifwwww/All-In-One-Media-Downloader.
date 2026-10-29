'use strict';
module.exports = function(j) { return fromLinks(j) || parse(j);
  function fromLinks(j) {
    const L = j && Array.isArray(j.links) ? j.links.filter(x => x && typeof x.url === "string" && /^https?:/i.test(x.url)) : [];
    if (!L.length) return null;
    const q = x => String(x.quality || "") + " " + String(x.type || x.format || "");
    const audio = L.find(x => /mp3|audio|music|m4a/i.test(q(x)));
    const vids = L.filter(x => x !== audio).map((x, i) => {
      const s = q(x); let sc = 0;
      if (/no_?wm|no.?water|without|nowm|clean/i.test(s)) sc += 4;
      else if (/water|(^|[^a-z])wm/i.test(s)) sc -= 6;
      if (/hd|high/i.test(s)) sc += 3;
      const px = s.match(/(\d{3,4})\s*p/i); if (px) sc += Number(px[1]) / 1000;
      return { x, sc, i };
    }).sort((a, b) => b.sc - a.sc || a.i - b.i);
    if (!vids.length && !audio) return null;
    const good = vids.filter(v => v.sc >= 0), wm = vids.find(v => v.sc < 0);
    const hd = (good[0] || vids[0] || {}).x, sd = (good[1] || good[0] || vids[0] || {}).x;
    const A = []; (function all(o, p) { if (o == null) return; if (typeof o === "object") { Array.isArray(o) ? o.forEach(x => all(x, p + "[]")) : Object.keys(o).forEach(k => all(o[k], p + "." + k)); } else A.push([p, o]); })(j, "");
    const nm = re => { const x = A.find(([p, v]) => re.test(p) && !/links/i.test(p) && (typeof v === "number" || /^\d+$/.test(v))); return x ? Number(x[1]) : undefined; };
    const tx = re => (A.find(([p, v]) => re.test(p) && !/links/i.test(p) && typeof v === "string" && !/^https?:/i.test(v) && v.trim()) || [])[1] || "";
    return {
      title: j.title || tx(/title|desc|caption/i) || "TikTok", duration: nm(/duration/i) || 0,
      play_count: nm(/play_?count|views?/i), digg_count: nm(/digg|likes?/i),
      cover: j.thumbnail || "", hdplay: hd ? hd.url : "", play: sd ? sd.url : "", wmplay: wm ? wm.x.url : "",
      music: audio ? audio.url : "", images: [], author: { nickname: tx(/nickname|author|creator|username|unique_?id/i), unique_id: "" }
    };
  }
  function walk(o, p, acc) {
    if (o == null) return;
    if (typeof o === "string") { acc.push([p, o]); return; }
    if (Array.isArray(o)) { o.forEach(x => walk(x, p + "[]", acc)); return; }
    if (typeof o === "object") for (const k in o) walk(o[k], p + "." + k, acc);
  }
  function parse(j) {
    const acc = []; walk(j, "", acc);
    const urls = acc.filter(([, v]) => /^https?:\/\//i.test(v));
    const imgRe = /\.(jpe?g|png|webp|heic|gif)(\?|$)/i;
    const images = urls.filter(([p, v]) => /(images|photos|slides|pictures)/i.test(p) && !/cover|avatar|thumb/i.test(p)).map(([, v]) => v);
    const music = (urls.find(([p, v]) => /music|audio|mp3|sound/i.test(p) || /\.mp3(\?|$)/i.test(v)) || [])[1] || "";
    const vids = urls.filter(([p, v]) => !images.includes(v) && v !== music && !imgRe.test(v) && !/cover|avatar|thumb|image|photo|music|audio|mp3|sound/i.test(p) &&
      (/mp4|video|play|nowm|water|download|hd|link|url/i.test(p) || /mp4|video/i.test(v)))
      .map(([p, v]) => {
        let s = 0;
        if (/hd|1080|720|high/i.test(p)) s += 3;
        if (/no_?wm|no_?water|without|nowm|clean/i.test(p)) s += 4;
        if (/(^|[^a-z])wm|water/i.test(p) && !/no|without|clean/i.test(p)) s -= 6;
        if (/mp4/i.test(v)) s += 1;
        return { p, v, s };
      }).sort((a, b) => b.s - a.s);
    if (!vids.length && !images.length) return null;
    const wm = vids.find(x => x.s < 0);
    const good = vids.filter(x => x.s >= 0);
    const hd = (good[0] || vids[0] || {}).v || "";
    const sd = (good[1] || good[0] || vids[0] || {}).v || hd;
    const str = re => (acc.find(([p, v]) => re.test(p) && !/^https?:\/\//i.test(v) && v.trim()) || [])[1] || "";
    const num = re => { const x = acc.find(([p]) => re.test(p)); return x ? Number(x[1]) || 0 : 0; };
    return {
      title: str(/title|desc|caption/i) || "TikTok",
      duration: num(/duration/i),
      hdplay: images.length ? "" : hd, play: images.length ? "" : sd, wmplay: wm ? wm.v : "",
      music, images,
      author: { nickname: str(/nickname|author/i), unique_id: str(/unique_?id|username/i) }
    };
  }
};
