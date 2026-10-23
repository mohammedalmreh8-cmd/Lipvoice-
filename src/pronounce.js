const ARTIC = {
  REST: { open: 0.06, round: 0.08, spread: 0.18, close: 0.72, press: 0.12, jaw: 0.04, viseme: "REST" },
  P: { open: 0.04, round: 0.1, spread: 0.12, close: 0.96, press: 0.82, jaw: 0.02, viseme: "M/B/P" },
  B: { open: 0.05, round: 0.1, spread: 0.14, close: 0.94, press: 0.78, jaw: 0.03, viseme: "M/B/P" },
  M: { open: 0.04, round: 0.12, spread: 0.16, close: 0.95, press: 0.7, jaw: 0.02, viseme: "M/B/P" },
  F: { open: 0.16, round: 0.06, spread: 0.28, close: 0.42, press: 0.88, jaw: 0.12, viseme: "F/V" },
  V: { open: 0.17, round: 0.06, spread: 0.3, close: 0.4, press: 0.84, jaw: 0.13, viseme: "F/V" },
  TH: { open: 0.2, round: 0.05, spread: 0.32, close: 0.28, press: 0.35, jaw: 0.16, viseme: "EH" },
  DH: { open: 0.2, round: 0.05, spread: 0.3, close: 0.28, press: 0.32, jaw: 0.16, viseme: "EH" },
  T: { open: 0.18, round: 0.08, spread: 0.22, close: 0.34, press: 0.22, jaw: 0.14, viseme: "EH" },
  D: { open: 0.2, round: 0.08, spread: 0.22, close: 0.3, press: 0.18, jaw: 0.16, viseme: "EH" },
  N: { open: 0.16, round: 0.1, spread: 0.2, close: 0.38, press: 0.16, jaw: 0.12, viseme: "EH" },
  L: { open: 0.22, round: 0.08, spread: 0.24, close: 0.22, press: 0.1, jaw: 0.18, viseme: "EH" },
  S: { open: 0.14, round: 0.04, spread: 0.48, close: 0.36, press: 0.28, jaw: 0.1, viseme: "EE" },
  Z: { open: 0.15, round: 0.05, spread: 0.46, close: 0.34, press: 0.26, jaw: 0.11, viseme: "EE" },
  SH: { open: 0.18, round: 0.42, spread: 0.12, close: 0.3, press: 0.22, jaw: 0.14, viseme: "EH" },
  ZH: { open: 0.18, round: 0.4, spread: 0.14, close: 0.3, press: 0.2, jaw: 0.14, viseme: "EH" },
  CH: { open: 0.16, round: 0.36, spread: 0.16, close: 0.4, press: 0.3, jaw: 0.12, viseme: "EH" },
  JH: { open: 0.18, round: 0.32, spread: 0.18, close: 0.34, press: 0.24, jaw: 0.14, viseme: "EH" },
  K: { open: 0.22, round: 0.12, spread: 0.2, close: 0.2, press: 0.1, jaw: 0.22, viseme: "EH" },
  G: { open: 0.24, round: 0.12, spread: 0.2, close: 0.18, press: 0.1, jaw: 0.24, viseme: "EH" },
  NG: { open: 0.16, round: 0.16, spread: 0.16, close: 0.32, press: 0.12, jaw: 0.14, viseme: "EH" },
  H: { open: 0.28, round: 0.08, spread: 0.18, close: 0.12, press: 0.06, jaw: 0.26, viseme: "AH" },
  R: { open: 0.18, round: 0.34, spread: 0.1, close: 0.28, press: 0.16, jaw: 0.14, viseme: "EH" },
  W: { open: 0.12, round: 0.92, spread: 0.02, close: 0.46, press: 0.2, jaw: 0.08, viseme: "OO/W" },
  Y: { open: 0.16, round: 0.08, spread: 0.72, close: 0.28, press: 0.12, jaw: 0.1, viseme: "EE" },
  IY: { open: 0.18, round: 0.04, spread: 0.88, close: 0.22, press: 0.08, jaw: 0.12, viseme: "EE" },
  IH: { open: 0.22, round: 0.08, spread: 0.62, close: 0.2, press: 0.08, jaw: 0.16, viseme: "EH" },
  EH: { open: 0.32, round: 0.08, spread: 0.48, close: 0.12, press: 0.06, jaw: 0.28, viseme: "EH" },
  AE: { open: 0.46, round: 0.06, spread: 0.52, close: 0.08, press: 0.04, jaw: 0.42, viseme: "AH" },
  AA: { open: 0.62, round: 0.12, spread: 0.22, close: 0.04, press: 0.02, jaw: 0.58, viseme: "AH" },
  AH: { open: 0.34, round: 0.16, spread: 0.22, close: 0.14, press: 0.06, jaw: 0.3, viseme: "UH" },
  AO: { open: 0.4, round: 0.62, spread: 0.08, close: 0.12, press: 0.08, jaw: 0.36, viseme: "OH" },
  OW: { open: 0.3, round: 0.78, spread: 0.04, close: 0.22, press: 0.1, jaw: 0.24, viseme: "OH" },
  UH: { open: 0.2, round: 0.7, spread: 0.06, close: 0.32, press: 0.12, jaw: 0.16, viseme: "OO/W" },
  UW: { open: 0.14, round: 0.96, spread: 0.02, close: 0.4, press: 0.14, jaw: 0.1, viseme: "OO/W" },
  ER: { open: 0.22, round: 0.38, spread: 0.16, close: 0.24, press: 0.12, jaw: 0.18, viseme: "EH" },
  AY: { open: 0.5, round: 0.1, spread: 0.4, close: 0.08, press: 0.04, jaw: 0.46, viseme: "AH" },
  AW: { open: 0.48, round: 0.42, spread: 0.16, close: 0.1, press: 0.06, jaw: 0.44, viseme: "AH" },
  OY: { open: 0.34, round: 0.7, spread: 0.18, close: 0.16, press: 0.08, jaw: 0.3, viseme: "OH" },
  EY: { open: 0.3, round: 0.08, spread: 0.58, close: 0.14, press: 0.06, jaw: 0.24, viseme: "EH" },
};

const DIPHTHONGS = {
  AY: ["AA", "IY"],
  AW: ["AA", "UH"],
  OY: ["AO", "IY"],
  EY: ["EH", "IY"],
  OW: ["AO", "UW"],
};

const PHONE_MS = {
  REST: 90,
  P: 90, B: 90, M: 110, F: 120, V: 120, TH: 110, DH: 110,
  T: 80, D: 80, N: 100, L: 110, S: 130, Z: 130, SH: 140, ZH: 140,
  CH: 120, JH: 120, K: 80, G: 80, NG: 120, H: 90, R: 120, W: 110, Y: 90,
  IY: 150, IH: 110, EH: 130, AE: 140, AA: 160, AH: 100, AO: 150,
  OW: 180, UH: 110, UW: 160, ER: 150, AY: 200, AW: 200, OY: 200, EY: 180,
};

const LEX_US = {
  i: "AY", a: "AH", an: "AH N", the: "DH AH", to: "T UW", you: "Y UW",
  love: "L AH V", need: "N IY D", water: "W AO T ER", food: "F UW D",
  help: "HH EH L P", yes: "Y EH S", no: "N OW", please: "P L IY Z",
  thank: "TH AE NG K", thanks: "TH AE NG K S",   hello: "HH AH L OW", are: "AA R",
  stop: "S T AA P", more: "M AO R", okay: "OW K EY", pain: "P EY N",
  tired: "T AY ER D", doctor: "D AA K T ER", bathroom: "B AE TH R UW M",
  remember: "R IH M EH M B ER", me: "M IY", look: "L UH K", easy: "IY Z IY",
  yet: "Y EH T", they: "DH EY", fill: "F IH L", in: "IH N", am: "AE M",
  incredible: "IH N K R EH D AH B AH L", is: "IH Z", trained: "T R EY N D",
  my: "M AY", name: "N EY M", want: "W AA N T", can: "K AE N",
  come: "K AH M", go: "G OW", here: "HH IY R", there: "DH EH R",
  this: "DH IH S", that: "DH AE T", what: "W AH T", where: "W EH R",
  when: "W EH N", who: "HH UW", why: "W AY", how: "HH AW",
  now: "N AW", later: "L EY T ER", today: "T AH D EY", good: "G UH D",
  bad: "B AE D", sorry: "S AA R IY", wait: "W EY T", open: "OW P AH N",
  close: "K L OW S", drink: "D R IH NG K", eat: "IY T", sleep: "S L IY P",
  home: "HH OW M", family: "F AE M AH L IY", friend: "F R EH N D",
  "i'm": "AY M", "don't": "D OW N T", "can't": "K AE N T",
  "you're": "Y UH R", "it's": "IH T S", "that's": "DH AE T S",
};

const LEX_UK = {
  ...LEX_US,
  water: "W AO T AH", doctor: "D AA K T AH", later: "L EY T AH",
  remember: "R IH M EH M B AH", trained: "T R EY N D",
  bathroom: "B AA TH R UW M", family: "F AE M IH L IY",
};

const AR_PHONE = {
  ا: "AA", أ: "AA", إ: "IH", آ: "AA", ء: "AH", ى: "AA", ئ: "IY", ؤ: "UW",
  ع: "AH", غ: "G", و: "UW", ي: "IY", ب: "B", م: "M", ف: "F",
  ه: "H", ة: "AH", ح: "H", خ: "K", ت: "T", ط: "T", د: "D", ض: "D",
  ن: "N", ل: "L", ر: "R", س: "S", ص: "S", ز: "Z", ش: "SH",
  ث: "TH", ذ: "DH", ظ: "DH", ك: "K", ق: "K", ج: "JH",
};

function clamp(v, a = 0, b = 1) {
  return Math.max(a, Math.min(b, v));
}

function tokenize(text, lang) {
  if (lang === "ar") return String(text).trim().split(/\s+/).filter(Boolean);
  return String(text)
    .toLowerCase()
    .replace(/[^a-z'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function letterPhones(word) {
  const w = word.replace(/'/g, "");
  const out = [];
  let i = 0;
  while (i < w.length) {
    const three = w.slice(i, i + 3);
    const two = w.slice(i, i + 2);
    if (three === "igh") {
      out.push("AY");
      i += 3;
    } else if (["tion", "sion"].includes(w.slice(i, i + 4))) {
      out.push("SH", "AH", "N");
      i += 4;
    } else if (["ch", "sh", "th", "ph", "wh", "qu", "ng", "ck", "wr"].includes(two)) {
      const map = { ch: "CH", sh: "SH", th: "TH", ph: "F", wh: "W", qu: "K", ng: "NG", ck: "K", wr: "R" };
      out.push(map[two]);
      i += 2;
    } else {
      const ch = w[i];
      const next = w[i + 1];
      const vowel = "aeiouy".includes(ch);
      const silentE = w.endsWith("e") && i < w.length - 1 && vowel;
      const map = {
        a: silentE ? "EY" : "AE",
        e: i === w.length - 1 ? null : "EH",
        i: silentE ? "AY" : "IH",
        o: silentE ? "OW" : "AA",
        u: silentE ? "UW" : "AH",
        y: i === 0 ? "Y" : "IY",
        b: "B", c: next === "e" || next === "i" || next === "y" ? "S" : "K",
        d: "D", f: "F", g: next === "e" || next === "i" ? "JH" : "G",
        h: "H", j: "JH", k: "K", l: "L", m: "M", n: "N", p: "P",
        q: "K", r: "R", s: "S", t: "T", v: "V", w: "W", x: "K", z: "Z",
      };
      if (ch === "x") out.push("K", "S");
      else if (map[ch]) out.push(map[ch]);
      i += 1;
    }
  }
  return out.filter(Boolean);
}

function arabicPhones(word) {
  const out = [];
  for (const ch of word) {
    const p = AR_PHONE[ch];
    if (p) out.push(p);
  }
  return out;
}

export function phonesForWord(word, lang, accent) {
  if (lang === "ar") return arabicPhones(word);
  const lex = accent === "uk" ? LEX_UK : LEX_US;
  const key = word.toLowerCase();
  if (lex[key]) return lex[key].split(" ");
  return letterPhones(key);
}

function expandPhone(phone) {
  const pair = DIPHTHONGS[phone];
  if (!pair) return [phone === "HH" ? "H" : phone];
  return pair;
}

function articFor(phone) {
  const key = phone === "HH" ? "H" : phone;
  return { ...(ARTIC[key] || ARTIC.AH) };
}

function blendArtic(a, b, t) {
  const out = {};
  for (const k of ["open", "round", "spread", "close", "press", "jaw"]) {
    out[k] = a[k] * (1 - t) + b[k] * t;
  }
  out.viseme = t < 0.5 ? a.viseme : b.viseme;
  return out;
}

function coarticulate(seq) {
  if (seq.length < 2) return seq;
  const out = seq.map((s) => ({ ...s, artic: { ...s.artic } }));
  for (let i = 0; i < out.length; i++) {
    const prev = out[i - 1];
    const next = out[i + 1];
    if (prev) out[i].artic = blendArtic(out[i].artic, prev.artic, 0.18);
    if (next) out[i].artic = blendArtic(out[i].artic, next.artic, 0.22);
  }
  return out;
}

export function phonesForText(text, lang = "en", accent = "us") {
  const words = tokenize(text, lang);
  const out = [];
  words.forEach((word) => {
    phonesForWord(word, lang, accent).forEach((raw) => {
      expandPhone(raw).forEach((phone) => out.push(phone));
    });
    out.push("REST");
  });
  return out;
}

export function phoneDuration(phone) {
  return PHONE_MS[phone] || 120;
}

export function buildPronunciation(text, lang = "en", accent = "us") {
  const words = tokenize(text, lang);
  if (!words.length) return { words: [], segments: [], duration: 0, accent, lang, text: "" };
  const segments = [];
  let t = 80;
  segments.push({
    t0: 0,
    t1: t,
    phone: "REST",
    word: "",
    wordIndex: -1,
    label: "",
    artic: articFor("REST"),
  });
  words.forEach((word, wi) => {
    const phones = phonesForWord(word, lang, accent);
    phones.forEach((raw) => {
      expandPhone(raw).forEach((phone) => {
        const dur = PHONE_MS[phone] || 120;
        segments.push({
          t0: t,
          t1: t + dur,
          phone,
          word,
          wordIndex: wi,
          label: phone,
          artic: articFor(phone),
        });
        t += dur;
      });
    });
    const gap = 70;
    segments.push({
      t0: t,
      t1: t + gap,
      phone: "REST",
      word,
      wordIndex: wi,
      label: "",
      artic: articFor("REST"),
    });
    t += gap;
  });
  return {
    words,
    segments: coarticulate(segments),
    duration: t,
    accent,
    lang,
    text: words.join(" "),
  };
}

export function articAt(guide, ms) {
  if (!guide?.segments?.length) return articFor("REST");
  const segs = guide.segments;
  if (ms <= segs[0].t0) return segs[0].artic;
  if (ms >= segs[segs.length - 1].t1) return segs[segs.length - 1].artic;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (ms >= s.t0 && ms < s.t1) {
      const next = segs[i + 1] || s;
      const span = Math.max(1, s.t1 - s.t0);
      const local = (ms - s.t0) / span;
      const ease = local * local * (3 - 2 * local);
      const look = clamp((ms - (s.t1 - 55)) / 55);
      return blendArtic(s.artic, next.artic, ease * 0.35 + look * 0.45);
    }
  }
  return segs[segs.length - 1].artic;
}

export function segmentAt(guide, ms) {
  return guide?.segments?.find((s) => ms >= s.t0 && ms < s.t1) || guide?.segments?.slice(-1)[0] || null;
}

export function mouthPath(artic, w = 260, h = 200) {
  const cx = w / 2;
  const cy = 138;
  const open = clamp(artic.open);
  const round = clamp(artic.round);
  const spread = clamp(artic.spread);
  const close = clamp(artic.close);
  const press = clamp(artic.press);
  const jaw = clamp(artic.jaw);
  const halfW = 28 + spread * 34 - round * 16 + press * 4;
  const halfH = 6 + open * 28 + jaw * 10 - close * 6;
  const pinch = 10 + round * 14 - spread * 5;
  const upperLift = 8 + press * 8 - open * 3;
  const lowerDrop = Math.max(8, halfH + jaw * 7);
  const ulx = cx - halfW;
  const urx = cx + halfW;
  const uly = cy - upperLift;
  const lly = cy + lowerDrop;
  const outer = [
    `M ${ulx} ${cy}`,
    `C ${ulx + pinch} ${uly - 6}, ${cx - 12} ${uly}, ${cx} ${uly}`,
    `C ${cx + 12} ${uly}, ${urx - pinch} ${uly - 6}, ${urx} ${cy}`,
    `C ${urx - pinch} ${lly + 4}, ${cx + 14} ${lly}, ${cx} ${lly}`,
    `C ${cx - 14} ${lly}, ${ulx + pinch} ${lly + 4}, ${ulx} ${cy}`,
    "Z",
  ].join(" ");
  const innerW = Math.max(8, halfW * (0.52 - close * 0.32 + open * 0.12));
  const innerH = Math.max(1.6, halfH * (0.5 + open * 0.4) * (1 - close * 0.5));
  const inner = [
    `M ${cx - innerW} ${cy}`,
    `C ${cx - innerW * 0.35} ${cy - innerH}, ${cx + innerW * 0.35} ${cy - innerH}, ${cx + innerW} ${cy}`,
    `C ${cx + innerW * 0.35} ${cy + innerH}, ${cx - innerW * 0.35} ${cy + innerH}, ${cx - innerW} ${cy}`,
    "Z",
  ].join(" ");
  return { outer, inner, teeth: innerH > 7 && open > 0.2 };
}

export const ACCENTS = [
  { id: "us", label: "US" },
  { id: "uk", label: "UK" },
];
