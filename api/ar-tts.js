export default async function handler(req, res) {
  const text = String(req.query?.q || "").trim().slice(0, 180);
  if (!text) {
    res.statusCode = 400;
    res.end("missing q");
    return;
  }
  const url =
    "https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=ar&q=" +
    encodeURIComponent(text);
  const upstream = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 LipVoice/1.0" },
  });
  if (!upstream.ok) {
    res.statusCode = upstream.status;
    res.end("tts-fail");
    return;
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.statusCode = 200;
  res.end(buf);
}
