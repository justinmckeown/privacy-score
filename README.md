# Privacy Risk Rating (v4)

A client‑side, single‑page web app to generate a **privacy risk rating** with a compact, shareable code.
This version (v4) adds **‘Negated’** to the **Privacy budget** control and updates the code format accordingly.

> No server required. Open `index.html` in a browser.

---

## ✨ Key features

- Six panels: **Code Input**, **Overview**, **Fundamentals**, **Privacy Specific**, **Control Mitigations**, **Override**, **Code Generation**
- **Scope** gating (Security / Privacy / Both) + **Data Type** gating (Aggregated / Non‑aggregated / Both)
- **Data type** gating: *Aggregated*, *Non‑aggregated*, or *Both* controls visibility + scoring applicability
- **Ease of execution** drives Likelihood (5→1), adjusted by **Prevention / Detection / Response** controls and **Privacy budget**
- Privacy Budget now supports **NA / Negated / Low / Medium / High**
- **Privacy attacks** (with severity): Averaging, Inference, Singling Out, Linkage (IE/EI), Re‑identification
- **Forced‑Critical eligibility**: (Scope includes Privacy) ∧ (Data type includes Aggregated) ∧ (Re‑identification=True) — still **overridable** with a warning
- **Overrides** for Likelihood/Impact/Overall + “Calculated” readouts
- **Autosave** to `localStorage` + **floating Reset**
- **Versioned** share code with **CRC‑8**; URL hash mirrors the state
- Clean, accessible UI; autosave + floating Reset



---

## 🧰 Quick start

1. Put `index.html`, `styles.css`, `app.js` in the same folder.
2. Open `index.html` in your browser.
3. Use panels top‑to‑bottom; click **Generate Code** to produce a share string.
4. Paste `[ref]-[code]` or `[code]` in **Code Input** then **Apply Code** to restore state.

---

## 📦 Panels & Inputs (at a glance)

### 1) Code Input
- Paste `[ref]-[code]` or just `[code]`. Parser splits on the **last hyphen**.
- Left part populates **Finding Reference**; right part decodes the state.

### 2) Overview
- **Finding Reference** (free text, prefix only; not encoded)
- **Scope of Impact**: Privacy / Security / Privacy & Security
- **User Data Types affected**: Aggregated / Non‑aggregated / Aggregated & Non‑aggregated
- **Ease of execution**: Trivial / Easy / Medium / Hard / Expert (mapped to 5..1)

### 3) Fundamentals
- **Confidentiality / Integrity / Availability**: NA / Low / Medium / High / Critical (0..4)

### 4) Privacy Specific
- **Averaging**: NA / Deidentified / Identified → intensities 0 / 0.5 / 1.0
- **Inference (sample size)**: NA / Large / Medium / Small → 0 / 0.33 / 0.67 / 1.0
- **Singling Out**: NA / True → 0 / 1.0
- **Linkage**: chips for **Internal→External** and **External→Internal** → 0.5 each (both=1.0)
- **Re‑identification**: NA / True → 0 / 1.0
- **Privacy budget (perceived effort)**: NA / Low / Medium / High → factors 0.00 / 0.20 / 0.40 / 0.60  
  *(Hidden unless the data type includes Aggregated.)*

### 5) Override
- **Likelihood**: Auto / Low / Medium / High
- **Impact**: Auto / Low / Medium / High
- **Overall**: Auto / Informational / Low / Medium / High / Critical
- Shows “Calculated” values for transparency.

### 6) Code Generation
- Produces share string: `[Finding Reference]-[code]` (prefix omitted if blank)
- URL hash mirrors the latest share string

---

## 🔢 Scoring model

### Normalization

**Fundamentals (CIA)**  
- Inputs: `C, I, A ∈ {0,1,2,3,4}` (NA..Critical)  
- Normalize using worst‑case (default):  
  `fundamentals_raw = max(C, I, A) / 4` → **[0..1]**

**Privacy attacks → intensities `vᵢ` in [0..1]**  
- From the chosen options (see table above).  
- Applicability depends on **User Data Types**:  
  - Aggregated ⇒ Averaging, Inference, Linkage, Re‑id  
  - Non‑aggregated ⇒ Singling Out, Linkage, Re‑id  
  - Both ⇒ all the above

**Severity weights (hierarchy: trivial → severe)**  
```
Averaging:       0.20
Inference:       0.40
Singling Out:    0.70
Linkage:         0.85
Re-identification: 1.00
```

**Weighted privacy average (applicability‑aware)**
```
A = set of applicable attacks
privacy_raw = ( Σ (wᵢ * vᵢ) for i∈A ) / ( Σ wᵢ for i∈A )   ∈ [0..1]
```

**Dominance rule**  
If **Re‑id=True**, set `privacy_raw = 1.0`.

### Scope combiner → Impact (normalized)

```
if Scope = Security:
    impact_raw = fundamentals_raw
elif Scope = Privacy:
    impact_raw = privacy_raw
else: # Privacy & Security
    impact_raw = max(fundamentals_raw, privacy_raw)
```

### Impact thresholds → level (1..3)
```
Impact = 3 if impact_raw ≥ 0.67
       = 2 if impact_raw ≥ 0.34
       = 1 otherwise
```

### Likelihood

**Ease of execution**: Trivial..Expert → `ease ∈ {5,4,3,2,1}`  
**Privacy budget factor**: NA/Low/Med/High → `f ∈ {0.00,0.20,0.40,0.60}` (applies only if Scope includes Privacy **and** data type includes Aggregated)

```
effectiveEase = ease * (1 - f)
```

**Likelihood thresholds → level (1..3)**
```
Likelihood = 3 if effectiveEase ≥ 4.0
           = 2 if effectiveEase ≥ 2.75
           = 1 otherwise
```

### Overall band (matrix)
Rows = Likelihood (1..3), Cols = Impact (1..3)

```
[ [Informational, Low,   Medium],
  [Low,           Medium, High  ],
  [Medium,        High,   Critical] ]
```

---

## 🚨 Forced‑Critical eligibility (overridable)

**Trigger** when all true:
1. **Scope includes Privacy**  (Privacy or Privacy & Security)  
2. **User Data Types includes Aggregated**  (Aggregated or Both)  
3. **Re‑identification = True**

**Effect**  
- Base Overall becomes **Critical** (pre‑override) and a flag is set.  
- The assessor **may override** Overall to a lower band.  
- If they lower it, a **warning** appears in the Privacy section:  
  *“Re‑identification involving aggregated data — base outcome Critical; assessor override applied.”*

**Critical bias (optional, config)**  
A separate, code‑only toggle can bump the matrix result by one band (capped at Critical) in defined edge cases (off by default).

---

## 🔁 Control flow (execution order)

1. **Decode** code (if present) → populate state.  
2. **Apply visibility rules** based on Scope + Data type.  
3. **Compute Fundamentals** → `fundamentals_raw`.  
4. **Compute Privacy** → intensities → weighted average → dominance.  
5. **Combine by Scope** → `impact_raw` → **Impact level (1..3)**.  
6. **Compute Likelihood** → `effectiveEase` (apply budget) → **Likelihood (1..3)**.  
7. **Matrix** → base **Overall**.  
8. **Forced‑Critical eligibility** → set base Overall to Critical if triggered.  
9. **Overrides**: Likelihood → Impact → recompute matrix → Overall; Overall override last.  
10. **Critical bias** (if enabled and Overall not overridden).  
11. **Generate** share string `[Finding Reference]-[code]`; update URL hash and localStorage.

---

## 🧪 Applicability matrix (Privacy panel)

| User Data Type | Averaging | Inference | Singling Out | Linkage | Re‑identification | Privacy Budget |
|---|---|---|---|---|---|---|
| **Aggregated** | ✅ | ✅ | ❌ | ✅ (probabilistic) | ✅ | ✅ |
| **Non‑aggregated** | ❌ | ❌ | ✅ | ✅ (deterministic) | ✅ | ❌ |
| **Both** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> The UI hides inapplicable controls. Values persist for round‑tripping but are ignored when not applicable.

---

## 🧬 Code format (v2)

**String:** `[Finding Reference]-[Base64URL]` (prefix optional).  
Parser splits on the **last hyphen**; left part is the reference (not encoded).

**Bytes:** `version(1) + payload(5) + crc8(1)` = **7 bytes**, Base64URL encoded (no `=`).

**Payload packing (LSB‑first)**

```
Byte0: bits 0-1 scope(0..2), 2-3 dataType(0..2), 4-6 ease(0..4), 7 c bit0
Byte1: bits 0-2 c bits1-3, 3-5 i(0..4), 6-7 a bits0-1
Byte2: bit0 a bit2, 1-2 avg(0..2), 3-4 inference(0..3), 5 sing(0/1), 6 link_ie(0/1), 7 link_ei(0/1)
Byte3: bit0 reid(0/1), 1-2 pb(0..3), 3-4 ovL(0..3), 5-6 ovI(0..3), 7 ovO bit0
Byte4: bits 0-2 ovO bits1-3 (0..5), 3-7 reserved
```

**CRC‑8**: polynomial `0x07` over the 5‑byte payload.

---

## ⚙️ Configuration (edit in `app.js`)

- `privacySeverity` weights for each attack type
- `privacyBudgetFactor` (NA/Low/Med/High)
- `likelihoodThresholds` and `impactThresholds`
- `overallMatrix` (3×3 to 5‑band)
- `criticalBias.enabled` and `criticalBias.when(ctx)`
- `allowOverrideForcedCritical` (logic already supports assessor lowering)

---

## ♿ Accessibility

- Buttons have ARIA roles and clear focus states.
- Segmented controls are buttons (not radios) for compactness; consider adding keyboard navigation if needed.
- Alerts provide textual context in the relevant panel.

---

## 📄 License

TBC

---

## 🙋 FAQ

**Can I change thresholds/weights?**  
Yes. All tunables live in the `CONFIG` block at the top of `app.js`.

**Will old codes keep working?**  
Yes. The version byte allows you to keep decoding logic for older versions alongside v2.
