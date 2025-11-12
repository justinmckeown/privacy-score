/* Polyfill: replaceChildren (for older environments) */
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function(...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    if (nodes.length) nodes.forEach(n => this.appendChild(n));
  };
}

/* =========================================================
   Privacy Risk Rating — v3
   Changes:
   - CIA now 0..3 (NA..High), normalized by /3
   - Added Control Mitigations: Prevention, Detection, Response (0..4)
   - Privacy Budget moved under Prevention; visible only when scope includes Privacy AND data type includes Aggregated
   - Likelihood: multiplicative mitigation model; Negated slightly increases likelihood
   - Code bumped to v3 with compact 5-byte payload (new packing)
   ========================================================= */

const CONFIG = {
  version: 4,

  labels: {
    scope: ["Privacy", "Security", "Privacy & Security"],  
    dataType: ["Aggregated", "Non-aggregated", "Aggregated & Non-aggregated"],
    ease: ["Trivial", "Easy", "Medium", "Hard", "Expert"],       // UI order; we store 5..1
    cia: ["NA", "Low", "Medium", "High"],                         // 0..3   (removed 'Critical')
    avg: ["NA", "Deidentified", "Identified"],                    // 0,0.5,1
    inference: ["NA", "Large", "Medium", "Small"],                // 0,1/3,2/3,1
    bin: ["NA", "True"],                                          // 0,1
    budget: ["NA", "Negated", "Low", "Medium", "High"],            // 3 bits now (includes Negated)
    ctrl5: ["NA", "Negated", "Weak", "Medium", "Strong"],         // 0..4
    override3: ["Auto", "Low", "Medium", "High"],                 // 0..3
    overallBands: ["Informational", "Low", "Medium", "High", "Critical"],
  },

  // Privacy attack severity weights
  privacySeverity: { averaging: 0.20, inference: 0.40, singling: 0.70, linkage: 0.85, reid: 1.00 },

  // Privacy budget factors (applies under Prevention when Scope includes Privacy AND DataType includes Aggregated)
  privacyBudgetFactor: [0.00, -0.10, 0.20, 0.40, 0.60], // NA, Negated, Low, Medium, High,

  // Mitigation factors (per level) — amount of reduction (negative increases likelihood)
  mitigations: {
    // Prevention applies multiplicatively with privacy budget
    prevention:  [0.00, -0.10, 0.10, 0.25, 0.45], // NA, Negated, Weak, Medium, Strong
    detection:   [0.00, -0.05, 0.05, 0.12, 0.20],
    response:    [0.00, -0.05, 0.03, 0.08, 0.12],
  },

  // Thresholds → Likelihood (from effectiveEase 1..5)
  likelihoodThresholds: { high: 4.0, medium: 2.75 },

  // Thresholds → Impact (from raw 0..1)
  impactThresholds: { high: 0.67, medium: 0.34 },

  // 3x3 Likelihood x Impact → band index (0..4)
  overallMatrix: [
    /*Lik=1*/ [0, 1, 2],
    /*Lik=2*/ [1, 2, 3],
    /*Lik=3*/ [2, 3, 4],
  ],

  // Critical bias (optional)
  criticalBias: {
    enabled: false,
    when: (ctx) => ctx.ciaMax === 3 || (ctx.reidTrue && ctx.likelihoodLevel === 3), // adjusted for CIA max=3
  },

  allowOverrideForcedCritical: true,
  storageKey: "prr.v3.state",
};

/* --------------------------
   STATE
--------------------------- */
const state = {
  // Overview
  scope: 1, dataType: 1, ease: 3,
  findingRef: "",

  // Fundamentals (0..3)
  c: 0, i: 0, a: 0,

  // Privacy Specific
  avg: 0, inference: 0, singling: 0, linkage_ie: 0, linkage_ei: 0, reid: 0,

  // Control Mitigations
  prev: 0, det: 0, resp: 0,
  pb: 0, // Privacy budget (nested under Prevention)

  // Overrides
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

  // Ease: Trivial..Expert labels, store 5..1
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

  // Fundamentals (0..3)
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

  // Privacy fields visibility
  toggleField("field-avg",       privacyEnabled && (agg || both));
  toggleField("field-inference", privacyEnabled && (agg || both));
  toggleField("field-singling",  privacyEnabled && (nonagg || both));
  toggleField("field-linkage",   privacyEnabled && (agg || nonagg || both));
  toggleField("field-reid",      privacyEnabled && (agg || nonagg || both));

  // Build privacy controls
  buildSegmentedWithZero(document.getElementById("avg"), CONFIG.labels.avg, state.avg, v => { state.avg = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("inference"), CONFIG.labels.inference, state.inference, v => { state.inference = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("singling"), CONFIG.labels.bin, state.singling, v => { state.singling = v; persistAndRender(); });
  buildChips(document.getElementById("linkage"), [
    { label: "Internal → External", get: () => state.linkage_ie, set: (x) => state.linkage_ie = x },
    { label: "External → Internal", get: () => state.linkage_ei, set: (x) => state.linkage_ei = x },
  ]);
  buildSegmentedWithZero(document.getElementById("reid"), CONFIG.labels.bin, state.reid, v => { state.reid = v; persistAndRender(); });

  // Mitigations panel
  buildSegmentedWithZero(document.getElementById("prev"), CONFIG.labels.ctrl5, state.prev, v => { state.prev = v; persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("det"),  CONFIG.labels.ctrl5, state.det,  v => { state.det = v;  persistAndRender(); });
  buildSegmentedWithZero(document.getElementById("resp"), CONFIG.labels.ctrl5, state.resp, v => { state.resp = v; persistAndRender(); });

  // Privacy Budget now under Prevention — visible only if (scope includes Privacy) AND (data type includes Aggregated)
  const showPB = privacyEnabled && (agg || both);
  toggleField("field-pb", showPB);
  if (showPB) {
    buildSegmentedWithZero(document.getElementById("pb"), CONFIG.labels.budget, state.pb, v => { state.pb = v; persistAndRender(); });
  } else {
    state.pb = 0; // clear when hidden
  }

  // Compute scores for Override readouts + warnings
  const scores = computeScores(state);

  // Warnings in Privacy section
  document.getElementById("forced-critical-warning").classList.toggle("hidden", !scores.flags.forcedCriticalEligible);
  document.getElementById("override-lowered-warning").classList.toggle("hidden",
    !(scores.flags.forcedCriticalEligible && scores.flags.overallLoweredFromCritical)
  );

  // Override dropdowns + calculated values
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
  // Fundamentals: max(C,I,A)/3  (CIA in 0..3)
  const ciaMax = Math.max(s.c, s.i, s.a); // 0..3
  const fundamentals_raw = (ciaMax / 3);

  // Privacy attacks intensities (0..1)
  const intens = {
    averaging: s.avg === 0 ? 0 : (s.avg === 1 ? 0.5 : 1.0),
    inference: [0, 1/3, 2/3, 1.0][clamp(s.inference,0,3)],
    singling: s.singling ? 1.0 : 0.0,
    linkage:  (s.linkage_ie ? 0.5 : 0) + (s.linkage_ei ? 0.5 : 0),
    reid:     s.reid ? 1.0 : 0.0,
  };

  // Applicability
  const agg = (s.dataType === 1 || s.dataType === 3);
  const nonagg = (s.dataType === 2 || s.dataType === 3);
  const applicable = {
    averaging: agg,
    inference: agg,
    singling: nonagg,
    linkage:  agg || nonagg,
    reid:     agg || nonagg,
  };

  // Weighted privacy average
  const weights = CONFIG.privacySeverity;
  let num = 0, den = 0;
  for (const k of Object.keys(intens)) {
    if (applicable[k]) { num += weights[k] * intens[k]; den += weights[k]; }
  }
  let privacy_raw = den > 0 ? (num/den) : 0;

  // Dominance
  const reidTrue = !!s.reid;
  if (reidTrue) privacy_raw = 1.0;

  // Scope combiner → impact_raw
  const scopePriv = includesPrivacy(s.scope);
  let impact_raw = 0;
  if (!scopePriv)      impact_raw = fundamentals_raw;
  else if (s.scope===1) impact_raw = privacy_raw;
  else                  impact_raw = Math.max(fundamentals_raw, privacy_raw);

  // Likelihood
  const ease = clamp(s.ease, 1, 5);

  // Mitigations (multiplicative model)
  const mf = CONFIG.mitigations;
  const mPrevBase = mf.prevention[clamp(s.prev,0,4)]; // can be negative (Negated)
  const hasAgg = agg;                                  // data type includes Aggregated?
  const pbFactor = (scopePriv && hasAgg) ? CONFIG.privacyBudgetFactor[clamp(s.pb,0,3)] : 0.0;

  // Combine prevention with privacy budget: rPrev = 1 - (1-rBase)*(1-pb)
  const rPrevCombined = 1 - (1 - mPrevBase) * (1 - pbFactor);
  const rDet = mf.detection[clamp(s.det,0,4)];
  const rResp = mf.response[clamp(s.resp,0,4)];

  // Total multiplier on ease: (1 - rPrev) * (1 - rDet) * (1 - rResp)
  let totalMult = (1 - rPrevCombined) * (1 - rDet) * (1 - rResp);
  // Safety clamp (avoid extreme increases/reductions)
  totalMult = clamp(totalMult, 0.1, 1.5);

  const effectiveEase = ease * totalMult;

  // Map to levels
  const lt = CONFIG.likelihoodThresholds;
  const it = CONFIG.impactThresholds;

  let baseLikelihoodLevel = effectiveEase >= lt.high ? 3 : (effectiveEase >= lt.medium ? 2 : 1);
  let baseImpactLevel = impact_raw >= it.high ? 3 : (impact_raw >= it.medium ? 2 : 1);
  let baseOverallBandIdx = CONFIG.overallMatrix[baseLikelihoodLevel - 1][baseImpactLevel - 1];

  // Forced-Critical eligibility: (scope includes Privacy) AND (data type includes Aggregated) AND (ReID true)
  const forcedCriticalEligible = scopePriv && agg && reidTrue;
  if (forcedCriticalEligible) baseOverallBandIdx = 4;

  // Apply overrides
  let likelihoodLevel = baseLikelihoodLevel;
  let impactLevel = baseImpactLevel;
  if (s.ovL) likelihoodLevel = clamp(s.ovL, 1, 3);
  if (s.ovI) impactLevel = clamp(s.ovI, 1, 3);

  let overallBandIdx = CONFIG.overallMatrix[likelihoodLevel - 1][impactLevel - 1];

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
   Code v3: compact 5-byte payload + version + crc (7 bytes total)
   Bit layout (LSB-first):
   0..1  scope(0..2)
   2..3  dataType(0..2)
   4..6  ease(0..4)
   7..8  C(0..3)
   9..10 I(0..3)
   11..12 A(0..3)
   13..14 avg(0..2)
   15..16 inference(0..3)
   17     sing(0/1)
   18     link_ie(0/1)
   19     link_ei(0/1)
   20     reid(0/1)
   21..22 pb(0..3)
   23..24 ovL(0..3)
   25..26 ovI(0..3)
   27..29 ovO(0..5)
   30..32 prev(0..4)
   33..35 det(0..4)
   36..38 resp(0..4)
--------------------------- */

function encodeCode(s) {
  const scope0 = clamp(s.scope,1,3) - 1;
  const dt0 = clamp(s.dataType,1,3) - 1;
  const ease0 = clamp(s.ease,1,5) - 1;

  const C = clamp(s.c,0,3), I = clamp(s.i,0,3), A = clamp(s.a,0,3);
  const avg = clamp(s.avg,0,2), inf = clamp(s.inference,0,3);
  const sing = s.singling ? 1 : 0, lie = s.linkage_ie ? 1 : 0, lei = s.linkage_ei ? 1 : 0, reid = s.reid ? 1 : 0;
  const pb = clamp(s.pb,0,3);
  const ovL = clamp(s.ovL,0,3), ovI = clamp(s.ovI,0,3), ovO = clamp(s.ovO,0,5);
  const prev = clamp(s.prev,0,4), det = clamp(s.det,0,4), resp = clamp(s.resp,0,4);

  let v = 0n;
  const set = (val, off) => { v |= (BigInt(val) << BigInt(off)); };

  set(scope0, 0);
  set(dt0, 2);
  set(ease0, 4);
  set(C, 7);
  set(I, 9);
  set(A, 11);
  set(avg, 13);
  set(inf, 15);
  set(sing, 17);
  set(lie, 18);
  set(lei, 19);
  set(reid, 20);
  set(pb, 21);
  set(ovL, 24);
  set(ovI, 26);
  set(ovO, 27);
  set(prev, 31);
  set(det, 34);
  set(resp, 37);

  // Emit 5 payload bytes
  const payload = new Uint8Array(5);
  for (let i = 0; i < 5; i++) {
    payload[i] = Number((v >> BigInt(8*i)) & 0xffn);
  }

  const version = CONFIG.version & 0xff;
  const crc = crc8(payload);
  const bytes = new Uint8Array([version, ...payload, crc]);
  return base64UrlEncode(bytes);
}

function decodeCode(code) {
  const bytes = base64UrlDecode(code);
  if (bytes.length !== 7) throw new Error("Invalid code length");
  const [version, ...rest] = bytes;
  if (version !== CONFIG.version) throw new Error(`Unsupported version: ${version}`);
  const payload = new Uint8Array(rest.slice(0,5));
  const crc = rest[5];
  if (crc8(payload) !== crc) throw new Error("Invalid code (CRC mismatch)");

  // Rebuild BigInt
  let v = 0n;
  for (let i = 4; i >= 0; i--) {
    v = (v << 8n) | BigInt(payload[i]);
  }
  const get = (off, bits) => Number((v >> BigInt(off)) & ((1n << BigInt(bits)) - 1n));

  const s = { ...state };
  s.scope = get(0,2) + 1;
  s.dataType = get(2,2) + 1;
  s.ease = get(4,3) + 1;

  s.c = get(7,2);
  s.i = get(9,2);
  s.a = get(11,2);

  s.avg = get(13,2);
  s.inference = get(15,2);
  s.singling = get(17,1);
  s.linkage_ie = get(18,1);
  s.linkage_ei = get(19,1);
  s.reid = get(20,1);

  s.pb = get(21,3);

  s.ovL = get(24,2);
  s.ovI = get(26,2);
  s.ovO = get(28,3);

  s.prev = get(31,3);
  s.det  = get(34,3);
  s.resp = get(37,3);

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
    avg: 0, inference: 0, singling: 0, linkage_ie: 0, linkage_ei: 0, reid: 0,
    prev: 0, det: 0, resp: 0, pb: 0,
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
