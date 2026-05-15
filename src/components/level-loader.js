import {
  buildGameSongEventsFromMarkdown,
  parseMarkdownSongTable,
  parseSongEffectsFromMarkdown
} from "../levels/markdown-song.js";

function padLevel(level) {
  const n = Math.max(0, Math.floor(Number(level) || 0));
  return String(n).padStart(4, "0");
}

function extractInstrumentNamesFromMarkdown(text) {
  const out = new Set();
  const lines = String(text || "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (!trimmed.endsWith("|")) continue;
    if (/^\|\s*-+\s*\|/.test(trimmed)) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells[0] === "Track") continue;
    const instrument = String(cells[1] || "")
      .trim()
      .toLowerCase();
    if (!instrument) continue;
    out.add(instrument);
  }
  if (!out.size) out.add("piano");
  return out;
}

export function startLevel(game, level, layout, nowTs) {
  game.songStartTs = nowTs;
  game.songEventIndex = 0;
  game.songEvents = game.levelSongCache.get(level) || [];
  game.activeMidiRange = game.levelMidiRange?.get(level) || null;
  game.notes = [];
  // --- Apply baseline effects for this level ---
  const effects = game.levelSongEffects?.get(level) || null;
  game.notePlayback?.applySongEffects?.(effects);
  void layout;
}

export function startLevelFlow(game, nowTs) {
  game.notes = [];
  game.songEvents = [];
  game.songEventIndex = 0;
  game.streak = 0;
  game.powerMode = false;
  game.powerModeLabelStartTs = 0;
  game.missCount = 0;
  game.lastMissTs = -Infinity;
  game.levelFailed = false;
  game.levelPerfect = false;
  game.songResolveSettledStartTs = 0;
  game.gameState = "level_banner";
  game.levelBannerStartTs = nowTs;
  void game.ensureLevelReady(game.currentLevel);
}

export function advanceLevel(game, nowTs, layout) {
  if (game.levelFailed) {
    if (game.isSingleLevelMode) {
      game.score = 0;
      game.startLevelFlow(nowTs);
    } else {
      game.enterGameOver(nowTs);
    }
    void layout;
    return;
  }
  if (game.runEndLevel != null && game.currentLevel >= game.runEndLevel) {
    game.returnToTitle();
    return;
  }
  const nextLevel = game.currentLevel + 1;
  if (nextLevel > game.maxLevel) {
    game.returnToTitle();
    return;
  }
  game.currentLevel = nextLevel;
  game.startLevelFlow(nowTs);
  void layout;
}

export async function ensureLevelReady(game, level) {
  game.levelReady ??= new Set();
  if (game.levelReady.has(level)) return;
  game.levelReadyLoads ??= new Map();
  if (game.levelReadyLoads.has(level)) return game.levelReadyLoads.get(level);
  const p = (async () => {
    await game.ensureLevelSongLoaded(level);
    await game.ensureLevelInstrumentsLoaded(level);
    game.levelReady.add(level);
  })().catch(() => {});
  game.levelReadyLoads.set(level, p);
  await p;
}

export async function ensureLevelSongLoaded(game, level) {
  if (game.levelSongCache.has(level)) return;
  if (game.levelSongLoads.has(level)) return;

  const p = (async () => {
    const url = `/src/levels/${padLevel(level)}.md`;
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load song: ${res.status}`);
    const text = await res.text();
    const parsed = parseMarkdownSongTable(text, { tickMs: game.songTickMs });
    const events = buildGameSongEventsFromMarkdown(parsed, {
      tickMs: game.songTickMs
    });
    for (const e of events) {
      e.instrument = String(e.instrument || "piano")
        .trim()
        .toLowerCase();
    }
    let minMidi = Infinity;
    let maxMidi = -Infinity;
    for (const e of events) {
      if (e.soundOnly || e.lane === 0) continue;
      if (!Number.isFinite(e.note)) continue;
      minMidi = Math.min(minMidi, e.note);
      maxMidi = Math.max(maxMidi, e.note);
    }
    if (!Number.isFinite(minMidi) || !Number.isFinite(maxMidi)) {
      minMidi = 60;
      maxMidi = 60;
    }
    game.levelMidiRange ??= new Map();
    game.levelMidiRange.set(level, { minMidi, maxMidi });
    game.levelSongTextCache ??= new Map();
    game.levelSongTextCache.set(level, text);
    game.levelSongCache.set(level, events);
    // --- Cache baseline effects for this level ---
    game.levelSongEffects ??= new Map();
    game.levelSongEffects.set(level, parseSongEffectsFromMarkdown(text));
  })().catch(() => {});
  game.levelSongLoads.set(level, p);
  await p;
}

export async function ensureLevelInstrumentsLoaded(game, level) {
  if (!window.Tone || !window.SampleLibrary) return;
  game.levelInstrumentLoads ??= new Map();
  if (game.levelInstrumentLoads.has(level)) {
    return game.levelInstrumentLoads.get(level);
  }
  const p = (async () => {
    const text = game.levelSongTextCache?.get(level);
    if (!text) return;
    const instruments = extractInstrumentNamesFromMarkdown(text);
    const loads = [];
    for (const instrument of instruments) {
      loads.push(game.notePlayback.loadInstrument(instrument));
    }
    await Promise.all(loads);
  })().catch(() => {});
  game.levelInstrumentLoads.set(level, p);
  await p;
}

export function decodeLane(lane) {
  const d = lane;
  const targetDir =
    d === 11 || d === 12
      ? "UP"
      : d === 21 || d === 22
        ? "LEFT"
        : d === 31 || d === 32
          ? "RIGHT"
          : d === 41 || d === 42
            ? "DOWN"
            : "MIDDLE";

  const corner =
    d === 11 || d === 21 || d === 51
      ? "TOP_LEFT"
      : d === 12 || d === 31 || d === 52
        ? "TOP_RIGHT"
        : d === 22 || d === 41 || d === 54
          ? "BOTTOM_LEFT"
          : "BOTTOM_RIGHT";

  return { targetDir, corner };
}

export function getNoteSpawnPoint(layout, corner) {
  if (corner === "TOP_LEFT") {
    return { x: layout.centers.LEFT.x, y: layout.centers.UP.y };
  }
  if (corner === "TOP_RIGHT") {
    return { x: layout.centers.RIGHT.x, y: layout.centers.UP.y };
  }
  if (corner === "BOTTOM_LEFT") {
    return { x: layout.centers.LEFT.x, y: layout.centers.DOWN.y };
  }
  return { x: layout.centers.RIGHT.x, y: layout.centers.DOWN.y };
}

export function maybeSpawnSongNotes(game, nowTs, layout) {
  if (!game.songEvents.length) return;
  while (game.songEventIndex < game.songEvents.length) {
    const e = game.songEvents[game.songEventIndex];
    const appearMs = e.startMs ?? e.appearMs ?? 0;
    const absStart = game.songStartTs + appearMs * game.songTickMs;
    if (absStart > nowTs) break;
    const midi = e.note ?? e.key ?? 0;

    if (e.soundOnly || e.lane === 0) {
      game.playNote(
        midi,
        e.durationMs ?? 220,
        e.velocity ?? 0.85,
        e.instrument ?? "piano",
        e.effects ?? null
      );
      game.songEventIndex++;
      continue;
    }

    const decoded = decodeLane(e.lane);
    const from = getNoteSpawnPoint(layout, decoded.corner);
    const to = layout.centers[decoded.targetDir];
    const hitTs =
      e.endMs != null
        ? game.songStartTs + e.endMs * game.songTickMs
        : e.travelMs != null
          ? absStart + e.travelMs * game.songTickMs
          : absStart;
    game.notes.push({
      id: `${absStart}-${Math.random().toString(16).slice(2)}`,
      lane: e.lane,
      midi,
      durationMs: e.durationMs ?? 220,
      velocity: e.velocity ?? 1,
      instrument: e.instrument ?? "piano",
      startCorner: decoded.corner,
      targetDir: decoded.targetDir,
      startTs: absStart,
      hitTs,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      hit: false,
      resolved: false,
      effects: e.effects ?? null
    });

    game.songEventIndex++;
  }
}
