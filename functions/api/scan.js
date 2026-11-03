const json = (obj, status = 200) =>
  Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

// ---------- मिलवणी (matching) : AI नाही, आपला कोड करतो ----------
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const compact = (s) => norm(s).replace(/ /g, "");

function grams(s) {
  const c = compact(s);
  const g = new Map();
  if (c.length < 3) { if (c) g.set(c, 1); return g; }
  for (let i = 0; i <= c.length - 3; i++) {
    const t = c.slice(i, i + 3);
    g.set(t, (g.get(t) || 0) + 1);
  }
  return g;
}
function dice(a, b) {
  const A = grams(a), B = grams(b);
  let sa = 0, sb = 0, inter = 0;
  A.forEach((v) => (sa += v));
  B.forEach((v) => (sb += v));
  if (!sa || !sb) return 0;
  A.forEach((v, k) => { if (B.has(k)) inter += Math.min(v, B.get(k)); });
  return (2 * inter) / (sa + sb);
}
const nums = (s) => new Set(String(s || "").match(/\d+/g) || []);
function numsCompatible(a, b) {
  if (!a.size || !b.size) return true;
  for (const x of a) if (b.has(x)) return true;
  return false;
}
const FORM = new Set(["hcl","hydrochloride","sodium","potassium","sulphate","sulfate","maleate","besylate","mesylate","tartrate","succinate","phosphate","trihydrate","dihydrate","anhydrous","tablet","tablets","capsule","capsules","syrup","injection"]);
const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length >= 3 && /^[a-z]+$/.test(w) && !FORM.has(w)));
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const wordSim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);
// दोन्ही सॉल्टमधील सर्व घटक (शब्द) सारखे असतील तरच true (cetirizine ≠ levocetirizine)
function sameSalt(A, B) {
  if (!A.size || !B.size || A.size !== B.size) return false;
  const left = [...B];
  for (const w of A) {
    let bi = -1, bs = 0;
    left.forEach((x, i) => { const sc = wordSim(w, x); if (sc > bs) { bs = sc; bi = i; } });
    if (bi < 0 || bs < 0.85) return false;
    left.splice(bi, 1);
  }
  return true;
}
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const setHit = (a, b) => [...a].some((x) => b.has(x));
// "same" = ताकद (mg) जुळली, "check" = ताकद ठरवता आली नाही, null = ताकद वेगळी (वगळा)
function strength(it, d) {
  const A = nums(it.salt), B = nums(d.s);
  if (A.size) return B.size ? (setEq(A, B) ? "same" : null) : "check";
  const A2 = nums(it.name), B2 = nums(d.n + " " + d.s);
  if (A2.size && B2.size) return setHit(A2, B2) ? "same" : null;
  return "check";
}
function jacc(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  a.forEach((x) => { if (b.has(x)) i++; });
  return i / (a.size + b.size - i);
}

function parseList(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const k = line.indexOf(": ");
    if (k < 1) continue;
    const idx = parseInt(line.slice(0, k), 10);
    if (!Number.isFinite(idx)) continue;
    const rest = line.slice(k + 2);
    const o = rest.lastIndexOf("("), c = rest.lastIndexOf(")");
    const n = o > 0 ? rest.slice(0, o).trim() : rest.trim();
    const s = o > 0 && c > o ? rest.slice(o + 1, c).trim() : "";
    out.push({ idx, n, s, nn: nums(n + " " + s), sw: words(s) });
  }
  return out;
}

function match(it, meds) {
  // 1) तोच ब्रँड (नावावरून)
  const itNums = nums(it.name + " " + it.salt);
  let exact = null, es = 0;
  for (const d of meds) {
    if (!numsCompatible(itNums, d.nn)) continue;
    const sc = dice(it.name, d.n);
    if (sc > es) { es = sc; exact = d.idx; }
  }
  if (es < 0.72) exact = null;

  // 2) तोच घटक (सॉल्ट) असलेली सर्व औषधे, कोणत्याही कंपनीची
  const iw = words(it.salt);
  const alts = [];
  for (const d of meds) {
    if (!sameSalt(iw, d.sw)) continue;
    const st = strength(it, d);
    if (st) alts.push({ i: d.idx, st });
  }
  if (exact !== null && !alts.some((a) => a.i === exact)) alts.push({ i: exact, st: "check" });

  const idx = exact !== null ? exact : (alts.length ? alts[0].i : null);
  const by = exact !== null ? "name" : (alts.length ? "salt" : "");
  return { idx, by, alts, exact };
}

// ---------- AI : फक्त फोटो वाचतो ----------
const PROMPT =
  "The image shows a medicine strip/box or a doctor's prescription. Read every medicine in it.\n" +
  "For each medicine return:\n" +
  "- name: the medicine name exactly as written (keep English letters).\n" +
  "- salt: the composition/salt (keep English letters).\n" +
  "- use: what it is used for, in simple MARATHI (Devanagari), everyday words of ordinary village and town people, " +
  "NOT medical terms. Maximum 8 words. Examples: diabetes -> 'शुगरची गोळी'; blood pressure -> 'बीपीची गोळी'; " +
  "paracetamol -> 'ताप आणि अंगदुखीची गोळी'; pantoprazole -> 'अॅसिडिटी, पोटातील जळजळीची गोळी'; " +
  "cetirizine -> 'सर्दी, अॅलर्जीची गोळी'; antibiotic -> 'जंतूंचा संसर्ग घालवणारी गोळी (अँटिबायोटिक)'; " +
  "calcium -> 'हाडांसाठी कॅल्शियमची गोळी'. Never use words like hypertension, analgesic, antacid, antihistamine. " +
  "If it is a syrup, ointment, drops or injection, say so (सिरप, मलम, थेंब, इंजेक्शन) instead of 'गोळी'.\n" +
  "If you cannot read a medicine with certainty, skip it. Do not guess.";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          salt: { type: "STRING" },
          use: { type: "STRING", description: "Simple everyday MARATHI in Devanagari, max 8 words. Never English or Hindi." },
        },
        required: ["name", "salt", "use"],
      },
    },
  },
  required: ["items"],
};

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  const key = env.GEMINI_API_KEY;
  if (!key) return json({ error: "सर्व्हरवर GEMINI_API_KEY सेट केलेला नाही." }, 500);
  const model = env.GEMINI_MODEL || "gemini-3.1-flash-lite";

  let body;
  try { body = await request.json(); } catch { return json({ error: "चुकीची विनंती" }, 400); }
  const image = String(body.image || "");
  if (!image || image.length > 4000000) return json({ error: "फोटो नाही किंवा खूप मोठा आहे." }, 400);
  const meds = parseList(String(body.list || "").slice(0, 400000));

  const think = String(env.THINK || "").trim();
  const call = (withThink) =>
    fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: image } }, { text: PROMPT }] }],
        generationConfig: Object.assign(
          { temperature: 0, maxOutputTokens: 1500, responseMimeType: "application/json", responseSchema: SCHEMA },
          withThink && think ? { thinkingConfig: { thinkingLevel: think } } : {}
        ),
      }),
    });

  let r, usedThink = false;
  try {
    r = await call(true);
    usedThink = !!think;
    if (!r.ok && r.status === 400 && think) { r = await call(false); usedThink = false; }
  } catch {
    return json({ error: "Google शी कनेक्ट होता आले नाही." }, 502);
  }
  const tAi = Date.now() - t0;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = r.status === 429 ? "आजची मोफत मर्यादा संपली. थोड्या वेळाने प्रयत्न करा." : "स्कॅन झाले नाही (" + r.status + ").";
    return json({ error: msg, detail: (data && data.error && data.error.message) || "" }, 502);
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  let items = [];
  try { items = JSON.parse(text).items || []; } catch {}

  items = items.map((it) => {
    const m = match(it, meds);
    return { name: String(it.name || ""), salt: String(it.salt || ""), use: String(it.use || ""), idx: m.idx, by: m.by, exact: m.exact, alts: m.alts };
  });
  return json({ items, ms: { ai: tAi, total: Date.now() - t0, model, think: usedThink ? think : "default" } });
}
