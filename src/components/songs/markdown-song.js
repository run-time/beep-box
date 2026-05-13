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
  // Fill in missing fields with defaults.
  if (!effects) return null;
  const out = {
    release: effects.release,
    reverb: effects.reverb ? { ...effects.reverb } : undefined,
    filter: effects.filter ? { ...effects.filter } : undefined,
    delay: effects.delay ? { ...effects.delay } : undefined
  };
  // Remove undefined sections
  Object.keys(out).forEach((k) => {
    if (!out[k]) delete out[k];
  });
  return Object.keys(out).length ? out : null;
}

function parseEffectValueToken(token) {
  // e.g. decay_7.0, wet_0.65, frequency_1400
  const [k, v] = token.split("_");
  if (!k || v === undefined) return null;
  const num = Number(v);
  return { key: k, value: Number.isFinite(num) ? num : v };
}

function parseEffectDirectiveRow(cells, prevEffects) {
  // cells: [ '', 'effect', ... ]
  let effects = cloneEffects(prevEffects) || {};
  let changed = false;
  for (let i = 2; i < cells.length; ++i) {
    const token = (cells[i] || "").toLowerCase();
    if (!token) continue;
    if (token === "default") {
      // Reset to default (clear all)
      effects = {};
      changed = true;
      continue;
    }
    if (token === "reverb") {
      effects.reverb = effects.reverb || {};
      changed = true;
      continue;
    }
    if (token === "release") {
      effects.release = effects.release || {};
      changed = true;
      continue;
    }
    if (token === "lowpass" || token === "filter") {
      effects.filter = { type: "lowpass" };
      changed = true;
      continue;
    }
    if (token === "highpass") {
      effects.filter = { type: "highpass" };
      changed = true;
      continue;
    }
    if (token === "delay") {
      effects.delay = effects.delay || {};
      changed = true;
      continue;
    }
    // Key-value pairs
    const kv = parseEffectValueToken(token);
    if (kv) {
      // Route to correct section
      if (effects.reverb && ["decay", "wet", "predelay"].includes(kv.key)) {
        effects.reverb[kv.key] = kv.value;
        changed = true;
      } else if (effects.release && kv.key === "amount") {
        effects.release.amount = kv.value;
        changed = true;
      } else if (effects.filter && kv.key === "frequency") {
        effects.filter.frequency = kv.value;
        changed = true;
      } else if (
        effects.delay &&
        ["time", "feedback", "wet"].includes(kv.key)
      ) {
        effects.delay[kv.key] = kv.value;
        changed = true;
      }
    }
  }
  return changed ? normalizeEffects(effects) : prevEffects;
}

// Parse legacy header effects and normalize
export function parseSongEffectsFromMarkdown(text) {
  // Looks for @effects-preset or @effects in the header
  const lines = String(text || "").split("\n");
  let effects = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("@effects-preset")) {
      // Not implemented: could map preset names to effect bundles
      continue;
    }
    if (trimmed.startsWith("@effects")) {
      // e.g. @effects reverb decay_2.0 wet_0.5
      const tokens = trimmed.split(/\s+/).slice(1);
      for (const token of tokens) {
        if (token === "reverb") effects.reverb = {};
        else if (token === "release") effects.release = {};
        else if (token === "lowpass" || token === "filter")
          effects.filter = { type: "lowpass" };
        else if (token === "highpass") effects.filter = { type: "highpass" };
        else if (token === "delay") effects.delay = {};
        else {
          const kv = parseEffectValueToken(token);
          if (kv) {
            if (
              effects.reverb &&
              ["decay", "wet", "predelay"].includes(kv.key)
            ) {
              effects.reverb[kv.key] = kv.value;
            } else if (effects.release && kv.key === "amount") {
              effects.release.amount = kv.value;
            } else if (effects.filter && kv.key === "frequency") {
              effects.filter.frequency = kv.value;
            } else if (
              effects.delay &&
              ["time", "feedback", "wet"].includes(kv.key)
            ) {
              effects.delay[kv.key] = kv.value;
            }
          }
        }
      }
    }
    // Stop at first table row
    if (trimmed.startsWith("|")) break;
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

    // Effect directive row: || effect | ... ||
    if ((cells[1] || "").toLowerCase() === "effect") {
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

export function buildGameSongEventsFromMarkdown(events, { tickMs = 10 } = {}) {
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
