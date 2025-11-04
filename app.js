/* Polyfill: replaceChildren (for older environments) */
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function(...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    if (nodes.length) nodes.forEach(n => this.appendChild(n));
  };
}

/* =========================================================
   Privacy Risk Rating — v2.1 (refinements)
   ========================================================= */

const CONFIG = {
  version: 2,

  labels: {
    scope: ["Privacy", "Security", "Privacy & Security"],
    dataType: ["Aggregated", "Non-aggregated", "Aggregated & Non-aggregated"],
    ease: ["Trivial", "Easy", "Medium", "Hard", "Expert"], // UI order; we store 5..1
    cia: ["NA", "Low", "Medium", "High", "Critical"],      // 0..4
    avg: ["NA", "Deidentified", "Identified"],             // 0,0.5,1
    inference: ["NA", "Large", "Medium", "Small"],         // 0,1/3,2/3,1
    bin: ["NA", "True"],                                   // 0,1
    budget: ["NA", "Low", "Medium", "High"],               // 0.00,0.20,0.40,0.60
    override3: ["Auto", "Low", "Medium", "High"],          // 0..3
    overallBands: ["Informational", "Low", "Medium", "High", "Critical"],
  },

  privacySeverity: { averaging: 0.20, inference: 0.40, singling: 0.70, linkage: 0.85, reid: 1.00 },
  privacyBudgetFactor: [0.00, 0.20, 0.40, 0.60],
  likelihoodThresholds: { high: 4.0, medium: 2.75 },
  impactThresholds: { high: 0.67, medium: 0.34 },
  overallMatrix: [
    /*Lik=1*/ [0, 1, 2],
    /*Lik=2*/ [1, 2, 3],
    /*Lik=3*/ [2, 3, 4],
  ],

  criticalBias: {
    enabled: false,
    when: (ctx) => ctx.ciaMax === 4 || (ctx.reidTrue && ctx.likelihoodLevel === 3),
  },

  allowOverrideForcedCritical: true,
  storageKey: "prr.v2.state",
};

/* --------------------------
   STATE
--------------------------- */
const state = {
  scope: 1, dataType: 1, ease: 3,
  findingRef: "",
  c: 0, i: 0, a: 0,
  avg: 0, inference: 0, singling: 0, linkage_ie: 0, linkage_ei: 0, reid: 0, pb: 0,
  ovL: 0, ovI: 0, ovO: 0,
};

/* --------------------------
   Utilities
--------------------------- */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const includesPrivacy = (scope) => (scope === 1 || scope === 3);
const includesAggregated = (dt) => (dt === 1 || dt === 3);
const splitRefAndCode = (s) => {
  const idx = s.lastIndexOf("-");
  if (idx === -1) return ["", s];
  return [s.slice(0, idx), s.slice(idx+1)];
};
const safeFindingRef = (s) => (s ? s.replace(/[^\w .\-\/]/g, "").slice(0, 40) : "");

/* --------------------------
   UI builders
--------------------------- */
function buildSegmented(el, labels, currentIdx, onSelect) {
  el.replaceChildren();
  labels.forEach((label, i) => {
    const v = i + 1;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "opt"; btn.setAttribute("role", "radio");
    btn.setAttribute("aria-pressed", String(currentIdx === v));
    btn.textContent = label;
    btn.addEventListener("click", () => onSelect(v));
    el.appendChild(btn);
  });
}

function buildSegmentedWithZero(el, labels, currentVal, onSelect) {
  el.replaceChildren();
  labels.forEach((label, i) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "opt"; btn.setAttribute("role", "radio");
    btn.setAttribute("aria-pressed", String(currentVal === i));
    btn.textContent = label;
    btn.addEventListener("click", () => onSelect(i));
    el.appendChild(btn);
  });
}

function buildChips(el, defs) {
  el.replaceChildren();
  defs.forEach(def => {
    const chip = document.createElement("button");
    chip.type = "button"; chip.className = "chip";
    chip.setAttribute("aria-pressed", String(def.get() === 1));
    chip.textContent = def.label;
    chip.addEventListener("click", () => { def.set(def.get() ? 0 : 1); persistAndRender(); });
    el.appendChild(chip);
  });
}

/* --------------------------
   Rendering
--------------------------- */
function renderUI() {
  // Overview
  buildSegmented(document.getElementById("scope"), CONFIG.labels.scope, state.scope, v => { state.scope = v; persistAndRender(); });
  buildSegmented(document.getElementById("dataType"), CONFIG.labels.dataType, state.dataType, v => { state.dataType = v; persistAndRender(); });

  // Ease: labels Trivial..Expert; store 5..1
  const easeEl = document.getElementById("ease");
  easeEl.replaceChildren();
  CONFIG.labels.ease.forEach((label, i) => {
    const v = 5 - i; // Trivial→5 ... Expert→1
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "opt"; btn.setAttribute("role", "radio");
    btn.setAttribute("aria-pressed", String(state.ease === v));
    btn.textContent = label;
    btn.addEventListener("click", () => { state.ease = v; persistAndRender(); });
    easeEl.appendChild(btn);
  });

  document.getElementById("findingRef").value = state.findingRef;

  // Fundamentals
  buildSegmentedWithZero(document.getElementById("confidentiality"), CONFIG.labels.cia, state.c, v => { state.c = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("integrity"),       CONFIG.labels.cia, state.i, v => { state.i = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("availability"),    CONFIG.labels.cia, state.a, v => { state.a = v; persistAndRender(); });

  // Privacy visibility
  const privacyEnabled = includesPrivacy(state.scope);
  document.getElementById("privacy-disabled").classList.toggle("hidden", privacyEnabled);
  document.getElementById("privacy-fields").classList.toggle("hidden", !privacyEnabled);

  const agg = (state.dataType === 1);
  const nonagg = (state.dataType === 2);
  const both = (state.dataType === 3);

  // Toggle hide per-field
  toggleField("field-avg", privacyEnabled && (agg || both));
  toggleField("field-inference", privacyEnabled && (agg || both));
  toggleField("field-singling", privacyEnabled && (nonagg || both));
  toggleField("field-linkage", privacyEnabled && (agg || nonagg || both));
  toggleField("field-reid", privacyEnabled && (agg || nonagg || both));
  toggleField("field-pb", privacyEnabled && (agg || both)); // only when aggregated is included
  if (!(privacyEnabled && (agg || both))) { state.pb = 0; }



  // Build controls (clicks are ignored by hidden fields anyway)
  buildSegmentedWithZero(document.getElementById("avg"), CONFIG.labels.avg, state.avg, v => { state.avg = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("inference"), CONFIG.labels.inference, state.inference, v => { state.inference = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("singling"), CONFIG.labels.bin, state.singling, v => { state.singling = v; persistAndRender(); });
  buildChips(document.getElementById("linkage"), [
    { label: "Internal → External", get: () => state.linkage_ie, set: (x) => state.linkage_ie = x },
    { label: "External → Internal", get: () => state.linkage_ei, set: (x) => state.linkage_ei = x },
  ]);
  buildSegmentedWithZero(document.getElementById("reid"), CONFIG.labels.bin, state.reid, v => { state.reid = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("pb"), CONFIG.labels.budget, state.pb, v => { state.pb = v; persistAndRender(); });

  // Compute scores (used for Override calculated readouts + warnings)
  const scores = computeScores(state);

  // Warnings (now in Privacy section)
  document.getElementById("forced-critical-warning").classList.toggle("hidden", !scores.flags.forcedCriticalEligible);
  document.getElementById("override-lowered-warning").classList.toggle("hidden",
    !(scores.flags.forcedCriticalEligible && scores.flags.overallLoweredFromCritical)
  );

  // Override dropdowns
  document.getElementById("ov-l").value = String(state.ovL);
  document.getElementById("ov-i").value = String(state.ovI);
  document.getElementById("ov-o").value = String(state.ovO);
  document.getElementById("calc-l").textContent = `${scores.baseLikelihoodLevel} (${["Low","Medium","High"][scores.baseLikelihoodLevel-1]})`;
  document.getElementById("calc-i").textContent = `${scores.baseImpactLevel} (${["Low","Medium","High"][scores.baseImpactLevel-1]})`;
  document.getElementById("calc-o").textContent = CONFIG.labels.overallBands[scores.baseOverallBandIdx];

  // Share code + URL hash
  const code = encodeCode(state);
  const pref = safeFindingRef(state.findingRef);
  const share = pref ? `${pref}-${code}` : code;
  document.getElementById("code-output").value = share;
  setHash(share);
  document.getElementById("share-link").textContent = location.href;

  // Sync top inputs convenience
  document.getElementById("finding-ref-input").value = state.findingRef;
}

function toggleField(fieldId, show) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

/* --------------------------
   Scoring
--------------------------- */
function computeScores(s) {
  const ciaMax = Math.max(s.c, s.i, s.a);
  const fundamentals_raw = (ciaMax / 4);

  const intens = {
    averaging: s.avg === 0 ? 0 : (s.avg === 1 ? 0.5 : 1.0),
    inference: [0, 1/3, 2/3, 1.0][clamp(s.inference,0,3)],
    singling: s.singling ? 1.0 : 0.0,
    linkage: (s.linkage_ie ? 0.5 : 0) + (s.linkage_ei ? 0.5 : 0),
    reid: s.reid ? 1.0 : 0.0,
  };

  const agg = (s.dataType === 1 || s.dataType === 3);
  const nonagg = (s.dataType === 2 || s.dataType === 3);
  const applicable = {
    averaging: agg,
    inference: agg,
    singling: nonagg,
    linkage: agg || nonagg,
    reid: agg || nonagg,
  };

  const weights = CONFIG.privacySeverity;
  let num = 0, den = 0;
  for (const k of Object.keys(intens)) {
    if (applicable[k]) { num += weights[k] * intens[k]; den += weights[k]; }
  }
  let privacy_raw = den > 0 ? (num/den) : 0;

  const reidTrue = !!s.reid;
  if (reidTrue) privacy_raw = 1.0;

  const scopePriv = includesPrivacy(s.scope);
  let impact_raw = 0;
  if (!scopePriv) impact_raw = fundamentals_raw;
  else if (s.scope === 1) impact_raw = privacy_raw;
  else impact_raw = Math.max(fundamentals_raw, privacy_raw);

  const ease = clamp(s.ease, 1, 5);

  const hasAgg = includesAggregated(s.dataType);
  const f = (scopePriv && hasAgg) ? CONFIG.privacyBudgetFactor[clamp(s.pd,0,3)] : 0.0;
  //const f = scopePriv ? CONFIG.privacyBudgetFactor[clamp(s.pb,0,3)] : 0.0; TODO: Delete this is above fix works
  
  
  const effectiveEase = ease * (1 - f);

  const lt = CONFIG.likelihoodThresholds;
  const it = CONFIG.impactThresholds;

  let baseLikelihoodLevel = effectiveEase >= lt.high ? 3 : (effectiveEase >= lt.medium ? 2 : 1);
  let baseImpactLevel = impact_raw >= it.high ? 3 : (impact_raw >= it.medium ? 2 : 1);
  let baseOverallBandIdx = CONFIG.overallMatrix[baseLikelihoodLevel - 1][baseImpactLevel - 1];

  const forcedCriticalEligible = scopePriv && includesAggregated(s.dataType) && reidTrue;
  if (forcedCriticalEligible) baseOverallBandIdx = 4;

  // Apply overrides (L/I)
  let likelihoodLevel = baseLikelihoodLevel;
  let impactLevel = baseImpactLevel;
  if (s.ovL) likelihoodLevel = clamp(s.ovL, 1, 3);
  if (s.ovI) impactLevel = clamp(s.ovI, 1, 3);

  let overallBandIdx = CONFIG.overallMatrix[likelihoodLevel - 1][impactLevel - 1];

  // If eligible, base is Critical unless Overall is explicitly overridden
  let overallLoweredFromCritical = false;
  if (forcedCriticalEligible) overallBandIdx = 4;

  if (s.ovO) {
    overallLoweredFromCritical = (forcedCriticalEligible && s.ovO < 5);
    overallBandIdx = clamp(s.ovO, 1, 5);
  } else {
    if (forcedCriticalEligible) {
      overallBandIdx = 4;
    } else if (CONFIG.criticalBias.enabled) {
      const ctx = { ciaMax, reidTrue, likelihoodLevel };
      if (CONFIG.criticalBias.when(ctx)) overallBandIdx = Math.min(4, overallBandIdx + 1);
    }
  }

  return {
    likelihoodLevel, impactLevel, overallBandIdx,
    baseLikelihoodLevel, baseImpactLevel, baseOverallBandIdx,
    flags: { forcedCriticalEligible, overallLoweredFromCritical, reidTrue }
  };
}

/* --------------------------
   Persistence & URL hash
--------------------------- */
function persist() { try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(state)); } catch {} }
function restore() { try { const raw = localStorage.getItem(CONFIG.storageKey); if (!raw) return false; Object.assign(state, JSON.parse(raw)); return true; } catch { return false; } }
function clearPersist() { try { localStorage.removeItem(CONFIG.storageKey); } catch {} }

function setHash(s) { if (location.hash.slice(1) !== s) history.replaceState(null, "", `#${s}`); }
function getHash() { return location.hash ? location.hash.slice(1) : ""; }

/* --------------------------
   Code: v2 payload (5 bytes) + version + crc (7 bytes total)
--------------------------- */
function encodeCode(s) {
  const scope0 = clamp(s.scope,1,3) - 1;
  const dt0 = clamp(s.dataType,1,3) - 1;
  const ease0 = clamp(s.ease,1,5) - 1;
  const c = clamp(s.c,0,4), i = clamp(s.i,0,4), a = clamp(s.a,0,4);
  const avg = clamp(s.avg,0,2), inf = clamp(s.inference,0,3);
  const sing = s.singling ? 1 : 0, lie = s.linkage_ie ? 1 : 0, lei = s.linkage_ei ? 1 : 0;
  const reid = s.reid ? 1 : 0, pb = clamp(s.pb,0,3);
  const ovL = clamp(s.ovL,0,3), ovI = clamp(s.ovI,0,3), ovO = clamp(s.ovO,0,5);

  const b0 = (scope0) | (dt0<<2) | (ease0<<4) | ((c & 0x1)<<7);
  const b1 = ((c>>1)&0x7) | ((i&0x7)<<3) | ((a&0x3)<<6);
  const b2 = ((a>>2)&0x1) | ((avg&0x3)<<1) | ((inf&0x3)<<3) | ((sing&0x1)<<5) | ((lie&0x1)<<6) | ((lei&0x1)<<7);
  const b3 = (reid&0x1) | ((pb&0x3)<<1) | ((ovL&0x3)<<3) | ((ovI&0x3)<<5) | ((ovO&0x1)<<7);
  const b4 = ((ovO>>1)&0x7);

  const payload = new Uint8Array([b0,b1,b2,b3,b4]);
  const version = CONFIG.version & 0xff;
  const crc = crc8(payload);
  const bytes = new Uint8Array([version, ...payload, crc]);
  return base64UrlEncode(bytes);
}

function decodeCode(code) {
  const bytes = base64UrlDecode(code);
  if (bytes.length !== 7) throw new Error("Invalid code length");
  const [version, b0,b1,b2,b3,b4, crc] = bytes;
  if (version !== CONFIG.version) throw new Error(`Unsupported version: ${version}`);
  const payload = new Uint8Array([b0,b1,b2,b3,b4]);
  if (crc8(payload) !== crc) throw new Error("Invalid code (CRC mismatch)");

  const s = { ...state };
  const scope0 = (b0) & 0x3;
  const dt0 = (b0>>2) & 0x3;
  const ease0 = (b0>>4) & 0x7;
  const c0 = (b0>>7) & 0x1;
  const cRest = (b1) & 0x7;
  const i = (b1>>3) & 0x7;
  const aLow2 = (b1>>6) & 0x3;
  const aHigh1 = (b2) & 0x1;
  const avg = (b2>>1) & 0x3;
  const inf = (b2>>3) & 0x3;
  const sing = (b2>>5) & 0x1;
  const lie = (b2>>6) & 0x1;
  const lei = (b2>>7) & 0x1;
  const reid = (b3) & 0x1;
  const pb = (b3>>1) & 0x3;
  const ovL = (b3>>3) & 0x3;
  const ovI = (b3>>5) & 0x3;
  const ovOlow = (b3>>7) & 0x1;
  const ovOhigh = (b4) & 0x7;

  s.scope = scope0 + 1;
  s.dataType = dt0 + 1;
  s.ease = ease0 + 1;
  s.c = (cRest<<1) | c0;
  s.i = i;
  s.a = (aHigh1<<2) | aLow2;
  s.avg = avg;
  s.inference = inf;
  s.singling = sing;
  s.linkage_ie = lie;
  s.linkage_ei = lei;
  s.reid = reid;
  s.pb = pb;
  s.ovL = ovL;
  s.ovI = ovI;
  s.ovO = (ovOhigh<<1) | ovOlow;

  return s;
}

/* --------------------------
   Base64URL + CRC-8
--------------------------- */
function base64UrlEncode(bytes) {
  let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(str) {
  const pad = "===".slice((str.length + 3) % 4);
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
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

/* --------------------------
   Events
--------------------------- */
function persistAndRender() { persist(); renderUI(); }

function applyCodeFromInputs() {
  const topRef = document.getElementById("finding-ref-input").value.trim();
  const raw = document.getElementById("code-input").value.trim();
  if (!raw) return;
  let ref = "", code = raw;
  if (raw.includes("-")) { const [l, r] = splitRefAndCode(raw); ref = l; code = r; }
  try {
    const s = decodeCode(code);
    Object.assign(state, s);
    state.findingRef = safeFindingRef(topRef || ref);
    persist();
    renderUI();
  } catch (e) { alert(e.message); }
}

function generateAndShowCode() {
  const code = encodeCode(state);
  const pref = safeFindingRef(state.findingRef);
  const share = pref ? `${pref}-${code}` : code;
  document.getElementById("code-output").value = share;
  setHash(share);
  renderUI();
}

function copyCode() {
  const v = document.getElementById("code-output").value.trim();
  if (!v) return;
  navigator.clipboard?.writeText(v);
}

function resetAll() {
  Object.assign(state, {
    scope: 1, dataType: 1, ease: 3,
    findingRef: "",
    c: 0, i: 0, a: 0,
    avg: 0, inference: 0, singling: 0, linkage_ie: 0, linkage_ei: 0, reid: 0, pb: 0,
    ovL: 0, ovI: 0, ovO: 0,
  });
  clearPersist();
  history.replaceState(null, "", location.pathname);
  renderUI();
}

/* --------------------------
   Boot
--------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  // Buttons
  document.getElementById("btn-apply").addEventListener("click", applyCodeFromInputs);
  document.getElementById("btn-generate").addEventListener("click", generateAndShowCode);
  document.getElementById("btn-copy").addEventListener("click", copyCode);
  document.getElementById("btn-reset-floating").addEventListener("click", resetAll);

  // Override dropdowns
  document.getElementById("ov-l").addEventListener("change", (e) => { state.ovL = parseInt(e.target.value || "0", 10); persistAndRender(); });
  document.getElementById("ov-i").addEventListener("change", (e) => { state.ovI = parseInt(e.target.value || "0", 10); persistAndRender(); });
  document.getElementById("ov-o").addEventListener("change", (e) => { state.ovO = parseInt(e.target.value || "0", 10); persistAndRender(); });

  // Finding Reference (canonical)
  document.getElementById("findingRef").addEventListener("input", (e) => { state.findingRef = safeFindingRef(e.target.value); persistAndRender(); });

  // Load from hash OR storage
  const hash = getHash();
  if (hash) {
    const [ref, code] = splitRefAndCode(hash);
    try { const s = decodeCode(code); Object.assign(state, s); state.findingRef = safeFindingRef(ref); } catch {}
  } else {
    restore();
  }

  renderUI();
});
