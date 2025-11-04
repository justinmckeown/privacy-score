/* ============================
   Privacy Risk Rating — v1
   ============================ */

/** ----- CONFIG (tune here) ----- **/
const CONFIG = {
  version: 1,
  labels: {
    levels: ["Low", "Medium", "High"], // 1..3 in UI
    riskType: ["Security", "Privacy", "Security & Privacy"],
    idTypes: ["Averaging Attack", "Singling Out", "Inference", "Linkage"],
    overallBands: ["Informational", "Low", "Medium", "High", "Critical"],
  },
  // Identification Types weights (0..1). Weighted average → scaled to 1..3
  idTypeWeights: {
    averaging: 0.25,
    singling: 1.0,
    inference: 0.5,
    linkage: 0.75,
  },
  // Risk type impact adjustments
  riskTypeAdj: { security: 0, privacy: 1, both: 2 },
  // 3x3 Likelihood x Impact matrix (rows: Lik 1..3, cols: Imp 1..3) → band index 0..4
  // 0: Informational, 1: Low, 2: Medium, 3: High, 4: Critical
  overallMatrix: [
    /*Lik=1*/ [0, 1, 2],
    /*Lik=2*/ [1, 2, 3],
    /*Lik=3*/ [2, 3, 4],
  ],
  // Autosave key
  storageKey: "prr.v1.state",
};

/** ----- STATE ----- **/
const state = {
  // 1..3
  cost: 2,
  linkability: 2,
  ease: 2,
  identifiability: 2,
  // 1..3 (1=Security, 2=Privacy, 3=Both)
  riskType: 1,
  // multi-select bitmask: bit0=averaging, bit1=singling, bit2=inference, bit3=linkage
  idTypesMask: 0,
};

/** ----- UTIL: UI builders ----- **/
function buildSegmented(el, options, current, onSelect, asRiskType = false) {
  el.replaceChildren();
  options.forEach((label, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `opt k${idx + 1}`;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-pressed", String(current === idx + 1));
    btn.textContent = label;
    btn.addEventListener("click", () => onSelect(idx + 1));
    el.appendChild(btn);
  });
  if (asRiskType) el.classList.add("risk-type");
}

function buildChips(el, labels, mask, onToggle) {
  el.replaceChildren();
  labels.forEach((label, idx) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    const pressed = !!(mask & (1 << idx));
    chip.setAttribute("aria-pressed", String(pressed));
    chip.textContent = label;
    chip.addEventListener("click", () => onToggle(idx));
    el.appendChild(chip);
  });
}

/** ----- STATE <-> UI ----- **/
function setCost(v) { state.cost = clamp(v, 1, 3); persistAndRender(); }
function setLinkability(v) { state.linkability = clamp(v, 1, 3); persistAndRender(); }
function setEase(v) { state.ease = clamp(v, 1, 3); persistAndRender(); }
function setIdentifiability(v) { state.identifiability = clamp(v, 1, 3); persistAndRender(); }
function setRiskType(v) { state.riskType = clamp(v, 1, 3); persistAndRender(); }
function toggleIdType(idx) { state.idTypesMask ^= (1 << idx); persistAndRender(); }

function renderUI() {
  buildSegmented(document.getElementById("cost"), CONFIG.labels.levels, state.cost, setCost);
  buildSegmented(document.getElementById("linkability"), CONFIG.labels.levels, state.linkability, setLinkability);
  buildSegmented(document.getElementById("ease"), CONFIG.labels.levels, state.ease, setEase);
  buildSegmented(document.getElementById("identifiability"), CONFIG.labels.levels, state.identifiability, setIdentifiability);
  buildSegmented(document.getElementById("riskType"), CONFIG.labels.riskType, state.riskType, setRiskType, true);
  buildChips(document.getElementById("idTypes"), CONFIG.labels.idTypes, state.idTypesMask, toggleIdType);

  const { likelihood, impact, overallBandIdx } = computeScores(state);
  document.getElementById("score-likelihood").textContent = `${likelihood} (${CONFIG.labels.levels[likelihood-1]})`;
  document.getElementById("score-impact").textContent = `${impact} (${CONFIG.labels.levels[impact-1]})`;
  const overallEl = document.getElementById("score-overall");
  overallEl.textContent = CONFIG.labels.overallBands[overallBandIdx];
  overallEl.className = `v badge band-${overallBandIdx}`;

  // Update share link
  const code = encodeCode(state);
  setHash(code);
  document.getElementById("share-link").textContent = location.href;
}

/** ----- SCORING ----- **/
function computeScores(s) {
  // Likelihood = average(cost, linkability, ease), rounded to nearest, 1..3
  const likelihood = clamp(Math.round(avg([s.cost, s.linkability, s.ease])), 1, 3);

  // Identification Types → weighted average 0..1 → scaled to 1..3
  const weights = [
    CONFIG.idTypeWeights.averaging,
    CONFIG.idTypeWeights.singling,
    CONFIG.idTypeWeights.inference,
    CONFIG.idTypeWeights.linkage,
  ];
  let selected = [];
  for (let i = 0; i < 4; i++) if (s.idTypesMask & (1 << i)) selected.push(weights[i]);
  const idWeighted = selected.length ? avg(selected) : 0; // 0..1
  const idScaled = clamp(Math.round(idWeighted * 2) + 1, 1, 3); // 1..3

  // Impact base = average(identifiability, idScaled)
  let impact = clamp(Math.round(avg([s.identifiability, idScaled])), 1, 3);

  // Risk type adjustment
  const adj = s.riskType === 1 ? CONFIG.riskTypeAdj.security
            : s.riskType === 2 ? CONFIG.riskTypeAdj.privacy
            : CONFIG.riskTypeAdj.both;
  impact = clamp(impact + adj, 1, 3);

  // Overall
  const overallBandIdx = CONFIG.overallMatrix[likelihood - 1][impact - 1];

  return { likelihood, impact, overallBandIdx };
}

/** ----- ENCODING (A + C): Base64URL with version + CRC-8 ----- **/
function encodeCode(s) {
  // Pack fields into 16 bits:
  // bits 0-1: cost (0..2)
  // bits 2-3: linkability (0..2)
  // bits 4-5: ease (0..2)
  // bits 6-7: identifiability (0..2)
  // bits 8-9: riskType (0..2)
  // bits 10-13: idTypesMask (4 bits)
  // bits 14-15: reserved (0)
  const pack = (s.cost-1) |
               ((s.linkability-1) << 2) |
               ((s.ease-1) << 4) |
               ((s.identifiability-1) << 6) |
               ((s.riskType-1) << 8) |
               ((s.idTypesMask & 0b1111) << 10);

  const payload = new Uint8Array([pack & 0xff, (pack >> 8) & 0xff]);
  const version = CONFIG.version & 0xff;
  const crc = crc8(payload); // CRC over payload (as agreed)

  const bytes = new Uint8Array([version, ...payload, crc]);
  return base64UrlEncode(bytes);
}

function decodeCode(code) {
  const bytes = base64UrlDecode(code);
  if (bytes.length < 4) throw new Error("Code too short");
  const [version, p0, p1, crc] = bytes;
  if (version !== CONFIG.version) throw new Error(`Unsupported version: ${version}`);
  const payload = new Uint8Array([p0, p1]);
  const calc = crc8(payload);
  if (calc !== crc) throw new Error("Invalid code (CRC mismatch)");

  const pack = p0 | (p1 << 8);
  const s = { ...state };
  s.cost = ((pack) & 0b11) + 1;
  s.linkability = ((pack >> 2) & 0b11) + 1;
  s.ease = ((pack >> 4) & 0b11) + 1;
  s.identifiability = ((pack >> 6) & 0b11) + 1;
  s.riskType = ((pack >> 8) & 0b11) + 1;
  s.idTypesMask = (pack >> 10) & 0b1111;
  return s;
}

/** ----- Base64URL helpers ----- **/
function base64UrlEncode(bytes) {
  let bin = "";
  bytes.forEach(b => bin += String.fromCharCode(b));
  let b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64;
}
function base64UrlDecode(str) {
  const pad = "===".slice((str.length + 3) % 4);
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ----- CRC-8 (poly 0x07) ----- **/
function crc8(bytes) {
  let crc = 0x00;
  for (let b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1);
      crc &= 0xFF;
    }
  }
  return crc;
}

/** ----- helpers ----- **/
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const avg = arr => (arr.reduce((s, x) => s + x, 0) / (arr.length || 1));

/** ----- Persistence & hash ----- **/
function persist() {
  try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(state)); } catch {}
}
function restore() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    Object.assign(state, obj);
    return true;
  } catch { return false; }
}
function clearPersist() { try { localStorage.removeItem(CONFIG.storageKey); } catch {} }

function setHash(code) {
  if (location.hash.slice(1) !== code) history.replaceState(null, "", `#${code}`);
}
function getHash() { return location.hash ? location.hash.slice(1) : ""; }

/** ----- UI events ----- **/
function persistAndRender() { persist(); renderUI(); }

function generateAndShowCode() {
  const code = encodeCode(state);
  document.getElementById("code-output").value = code;
  setHash(code);
  renderUI(); // refresh share link
}

function applyCodeFromInput() {
  const input = document.getElementById("code-input").value.trim();
  if (!input) return;
  try {
    const s = decodeCode(input);
    Object.assign(state, s);
    persist();
    renderUI();
    document.getElementById("code-output").value = input;
  } catch (e) {
    alert(e.message);
  }
}

function copyCode() {
  const v = document.getElementById("code-output").value.trim();
  if (!v) return;
  navigator.clipboard?.writeText(v).then(() => {}, () => {});
}

function resetAll() {
  Object.assign(state, {
    cost: 2, linkability: 2, ease: 2, identifiability: 2, riskType: 1, idTypesMask: 0
  });
  clearPersist();
  document.getElementById("code-input").value = "";
  document.getElementById("code-output").value = "";
  history.replaceState(null, "", location.pathname); // clear hash
  renderUI();
}

/** ----- Boot ----- **/
window.addEventListener("DOMContentLoaded", () => {
  // Wire buttons
  document.getElementById("btn-generate").addEventListener("click", generateAndShowCode);
  document.getElementById("btn-apply").addEventListener("click", applyCodeFromInput);
  document.getElementById("btn-copy").addEventListener("click", copyCode);
  document.getElementById("btn-reset").addEventListener("click", resetAll);

  // Load from hash OR storage
  const hash = getHash();
  if (hash) {
    try { Object.assign(state, decodeCode(hash)); } catch {}
  } else {
    restore();
  }

  // Initial render
  renderUI();
});
