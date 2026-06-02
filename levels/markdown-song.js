function parsePipeRow(line) {
  // Example:
  // | 0 | piano | 42 | 70 | A#4 | 0.394 | 0.134 | 33.08 | 1.2 |
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  if (!trimmed.endsWith("|")) return null;
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
  return cells;
}

// --- Effect helpers ---
export function cloneEffects(effects) {
  return effects ? JSON.parse(JSON.stringify(effects)) : null;
}

export function normalizeEffects(effects) {
  // Clone effect sections and drop any empty entries.
  if (!effects) return null;
  const out = {};
  for (const [key, value] of Object.entries(effects)) {
    if (value == null) continue;
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? { ...value }
        : value;
  }
  return Object.keys(out).length ? out : null;
}

function parseEffectValueToken(token) {
  // e.g. decay_7.0, wet_0.65, frequency_1400
  const [k, v] = token.split("_");
  if (!k || v === undefined) return null;
  const num = Number(v);
  return { key: k, value: Number.isFinite(num) ? num : v };
}

function getEffectDirectiveRowMeta(cells) {
  let index = 0;
  while (index < cells.length && !String(cells[index] || "").trim()) index++;
  const directive = String(cells[index] || "").trim().toLowerCase();
  if (directive !== "sfx") return null;
  return {
    directive,
    mode: String(cells[index + 1] || "").trim().toLowerCase(),
    startIndex: index + 2
  };
}

function parseEffectRowPairCell(cells, index) {
  const rawKey = String(cells[index] || "").trim();
  if (!rawKey) return { nextIndex: index + 1, pair: null };
  const kv = parseEffectValueToken(rawKey.toLowerCase());
  if (kv) return { nextIndex: index + 1, pair: kv };

  const rawValue = String(cells[index + 1] || "").trim();
  if (!rawValue) return { nextIndex: index + 1, pair: null };
  const num = Number(rawValue);
  if (!Number.isFinite(num)) return { nextIndex: index + 1, pair: null };
  return {
    nextIndex: index + 2,
    pair: { key: rawKey.toLowerCase(), value: num }
  };
}

function ensureEffectSection(effects, mode) {
  switch (mode) {
    case "release":
      effects.release = effects.release || {};
      return true;
    case "reverb":
      effects.reverb = effects.reverb || {};
      return true;
    case "delay":
      effects.delay = effects.delay || {};
      return true;
    case "lowpass":
    case "filter":
      effects.filter = { ...(effects.filter || {}), type: "lowpass" };
      return true;
    case "highpass":
      effects.filter = { ...(effects.filter || {}), type: "highpass" };
      return true;
    case "eq":
      effects.eq = effects.eq || {};
      return true;
    case "chorus":
      effects.chorus = effects.chorus || {};
      return true;
    case "distortion":
      effects.distortion = effects.distortion || {};
      return true;
    default:
      return false;
  }
}

function applyEffectPairToEffects(effects, mode, key, value) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  const actualKey = normalizedKey === "predelay" ? "preDelay" : normalizedKey;

  if (mode === "release" && actualKey === "amount") {
    effects.release = effects.release || {};
    effects.release.amount = value;
    return true;
  }
  if (mode === "reverb" && ["decay", "wet", "preDelay"].includes(actualKey)) {
    effects.reverb = effects.reverb || {};
    effects.reverb[actualKey] = value;
    return true;
  }
  if (
    mode === "delay" &&
    ["time", "feedback", "wet"].includes(actualKey)
  ) {
    effects.delay = effects.delay || {};
    effects.delay[actualKey] = value;
    return true;
  }
  if (
    (mode === "lowpass" || mode === "filter" || mode === "highpass") &&
    actualKey === "frequency"
  ) {
    effects.filter = effects.filter || {};
    if (!effects.filter.type) {
      effects.filter.type = mode === "highpass" ? "highpass" : "lowpass";
    }
    effects.filter.frequency = value;
    return true;
  }
  if (mode === "eq" && ["high", "mid", "low"].includes(actualKey)) {
    effects.eq = effects.eq || {};
    effects.eq[actualKey] = value;
    return true;
  }
  if (
    mode === "chorus" &&
    ["depth", "frequency", "delaytime"].includes(actualKey)
  ) {
    effects.chorus = effects.chorus || {};
    effects.chorus[actualKey === "delaytime" ? "delayTime" : actualKey] = value;
    return true;
  }
  if (mode === "distortion" && actualKey === "amount") {
    effects.distortion = effects.distortion || {};
    effects.distortion.amount = value;
    return true;
  }
  return false;
}

function parseEffectDirectiveRow(cells, prevEffects) {
  const meta = getEffectDirectiveRowMeta(cells);
  if (!meta) return prevEffects;
  if (meta.mode === "default") return normalizeEffects({});

  const effects = cloneEffects(prevEffects) || {};
  let changed = ensureEffectSection(effects, meta.mode);

  for (let i = meta.startIndex; i < cells.length; ) {
    const parsed = parseEffectRowPairCell(cells, i);
    i = parsed.nextIndex;
    if (!parsed.pair) continue;
    if (applyEffectPairToEffects(effects, meta.mode, parsed.pair.key, parsed.pair.value)) {
      changed = true;
    }
  }

  return changed ? normalizeEffects(effects) : prevEffects;
}

export function parseSongEffectsFromMarkdown(text) {
  const lines = String(text || "").split("\n");
  let effects = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    // Skip separator rows and consume leading effect directives.
    if (/^\|\s*-+\s*\|/.test(trimmed)) continue;
    const cells = parsePipeRow(line);
    if (!cells || !cells.length) continue;
    const effectMeta = getEffectDirectiveRowMeta(cells);
    if (!effectMeta) break;
    effects = parseEffectDirectiveRow(cells, effects);
  }
  return normalizeEffects(effects);
}

export function parseMarkdownSongTable(text, { tickMs = 10 } = {}) {
  const lines = text.split("\n");
  const events = [];
  let activeEffects = parseSongEffectsFromMarkdown(text);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    // Skip header separator rows.
    if (/^\|\s*-+\s*\|/.test(trimmed)) continue;
    const cells = parsePipeRow(line);
    if (!cells || !cells.length) continue;

    // Effect directive row: | sfx | ... |
    const effectMeta = getEffectDirectiveRowMeta(cells);
    if (effectMeta) {
      activeEffects = parseEffectDirectiveRow(cells, activeEffects);
      continue;
    }

    // Note row: must have at least 9 cells
    if (cells.length < 9) continue;
    // Skip the header row by looking for non-numeric track.
    if (cells[0] === "Track") continue;

    const track = Number(cells[0]);
    const instrument = String(cells[1] || "piano");
    const lane = Number(cells[2]);
    const midi = Number(cells[3]);
    const velocity = Number(cells[5]);
    const durationSec = Number(cells[6]);
    const timeSec = Number(cells[7]);
    const leadSec = Number(cells[8]);

    if (!Number.isFinite(timeSec) || !Number.isFinite(midi)) continue;

    const laneNum = Number.isFinite(lane) ? lane : 0;
    const soundOnly = laneNum === 0;

    const hitTick = Math.max(0, Math.round((timeSec * 1000) / tickMs));
    const durationMs = Number.isFinite(durationSec)
      ? Math.max(40, Math.round(durationSec * 1000))
      : 220;
    const leadMs = Number.isFinite(leadSec)
      ? Math.max(0, Math.round(leadSec * 1000))
      : 1200;
    const leadTicks = Math.round(leadMs / tickMs);

    events.push({
      track: Number.isFinite(track) ? track : 0,
      instrument,
      lane: soundOnly ? 0 : laneNum,
      note: midi,
      velocity: Number.isFinite(velocity) ? velocity : 1,
      durationMs,
      leadTicks,
      hitTick,
      soundOnly,
      effects: activeEffects ? cloneEffects(activeEffects) : null
    });
  }

  // Sort by hit time then lane so playback is consistent.
  events.sort((a, b) => a.hitTick - b.hitTick || a.lane - b.lane);
  return events;
}

export function buildGameSongEventsFromMarkdown(events) {
  // Convert markdown rows into the in-game event schema consumed by
  // `maybeSpawnSongNotes`.
  //
  // IMPORTANT: Only rows with a non-zero `lane` should produce circles.
  // If `lane` is 0, it is sound-only.
  const out = [];
  let minStart = Infinity;

  for (const e of events) {
    if (e.soundOnly || e.lane === 0) {
      out.push({
        lane: 0,
        note: e.note,
        startMs: e.hitTick,
        durationMs: e.durationMs,
        velocity: e.velocity,
        instrument: e.instrument,
        soundOnly: true,
        effects: e.effects ?? null
      });
      continue;
    }

    const leadTicks = Math.max(0, e.leadTicks ?? 0);
    const startMs = e.hitTick - leadTicks;
    minStart = Math.min(minStart, startMs);

    out.push({
      lane: e.lane,
      note: e.note,
      startMs,
      endMs: e.hitTick,
      durationMs: e.durationMs,
      velocity: e.velocity,
      instrument: e.instrument,
      effects: e.effects ?? null
    });
  }

  if (Number.isFinite(minStart) && minStart < 0) {
    const shift = -minStart;
    for (const e of out) {
      e.startMs += shift;
      if (e.endMs != null) e.endMs += shift;
    }
  }

  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return out;
}

export async function loadMarkdownSong(url, { tickMs = 10 } = {}) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load markdown song: ${res.status}`);
  const text = await res.text();
  const parsed = parseMarkdownSongTable(text, { tickMs });
  return buildGameSongEventsFromMarkdown(parsed, { tickMs });
}
