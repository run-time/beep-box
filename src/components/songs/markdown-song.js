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

export function parseMarkdownSongTable(text, { tickMs = 10 } = {}) {
  const lines = text.split("\n");
  const rows = [];

  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    // Skip header separator rows.
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    const cells = parsePipeRow(line);
    if (!cells || cells.length < 9) continue;
    // Skip the header row by looking for non-numeric track.
    if (cells[0] === "Track") continue;
    rows.push(cells);
  }

  const events = [];
  for (const cells of rows) {
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
      soundOnly
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
        soundOnly: true
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
      instrument: e.instrument
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
