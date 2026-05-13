export function maybeSpawnRandomNote(game, nowTs, layout) {
  const elapsedPlayingMs = Math.max(0, nowTs - (game.playingStartTs || nowTs));
  const maxActiveNotes = Math.min(5, 1 + Math.floor(elapsedPlayingMs / 12000));
  const activeNotes = game.notes.filter((n) => !n.resolved).length;
  if (activeNotes >= maxActiveNotes) return;

  const interval = Math.max(
    260,
    game.spawnIntervalMs - Math.floor(elapsedPlayingMs / 30000) * 80
  );
  if (game.lastSpawnTs && nowTs - game.lastSpawnTs < interval) return;
  game.lastSpawnTs = nowTs;

  const midi = 21 + Math.floor(Math.random() * 88);
  const corners = Object.keys(layout.corners);
  const startCorner = corners[Math.floor(Math.random() * corners.length)];
  const possibleTargets = layout.cornerTargets[startCorner];
  const targetDir =
    possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

  const from = game.getNoteSpawnPoint(layout, startCorner);
  const to = layout.centers[targetDir];
  const travelMs = 1350 + Math.random() * 650;
  const startTs = nowTs;
  const hitTs = nowTs + travelMs;

  const chordChance = Math.min(0.35, 0.08 + elapsedPlayingMs / 70000);
  const wantChord = maxActiveNotes >= 2 && Math.random() < chordChance;
  const chordSize = wantChord ? (Math.random() < 0.65 ? 2 : 3) : 1;

  const chordNotes = buildChordMidi(midi, chordSize);
  for (const m of chordNotes) {
    game.notes.push({
      id: `${nowTs}-${Math.random().toString(16).slice(2)}`,
      midi: m,
      startCorner,
      targetDir,
      startTs,
      hitTs,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      hit: false,
      resolved: false
    });
  }
}

export function buildChordMidi(rootMidi, size) {
  const clamp = (m) => Math.max(21, Math.min(108, m));
  if (size <= 1) return [clamp(rootMidi)];
  const minor = Math.random() < 0.4;
  const third = minor ? 3 : 4;
  const fifth = 7;
  const tones = [rootMidi, rootMidi + third, rootMidi + fifth];
  const adjusted = tones.map((m) => (m > 96 ? m - 12 : m));
  const unique = Array.from(new Set(adjusted.map(clamp)));
  return unique.slice(0, size);
}

export function updateNotes(game, dtMs) {
  void dtMs;
  const nowTs = performance.now();
  game.notes = game.notes.filter((n) => nowTs - n.hitTs < 650);
}

export function resolveNoteHits(game, nowTs) {
  const graceMs = Number.isFinite(game.targetHitGraceMs)
    ? Math.max(0, game.targetHitGraceMs)
    : 0;
  const noteIsHitInGraceWindow = (note) => {
    if (note.assistOk) return true;
    if (
      game.play_mode === "use-the-tap" &&
      game.tapActiveDir === note.targetDir &&
      game.isDirectionActive(note.targetDir)
    ) {
      return true;
    }
    const inPostWindow = nowTs <= note.hitTs + graceMs;
    if (inPostWindow && game.isDirectionActive(note.targetDir)) return true;
    const lastActivatedTs = game.lastDirectionActivatedTs?.get(note.targetDir);
    return (
      Number.isFinite(lastActivatedTs) &&
      lastActivatedTs >= note.hitTs - graceMs &&
      lastActivatedTs <= note.hitTs + graceMs
    );
  };

  const resolving = [];
  for (const note of game.notes) {
    if (note.resolved) continue;
    if (nowTs < note.startTs) continue;
    if (nowTs < note.hitTs) continue;
    resolving.push(note);
  }

  if (!resolving.length) return;
  if (game.GAME_MODE === "dev-record") {
    for (const note of resolving) {
      note.resolved = true;
      note.hit = true;
      note.captureAnimStartTs = nowTs;
      game.playNote(
        note.midi,
        note.durationMs ?? 220,
        note.velocity ?? 0.85,
        note.instrument ?? "piano",
        note.effects ?? null
      );
    }
    return;
  }
  resolving.sort((a, b) => a.hitTs - b.hitTs);
  const groupHitTs = resolving[0].hitTs;
  const group = resolving.filter((n) => Math.abs(n.hitTs - groupHitTs) < 2);
  const allHit = group.every((n) => noteIsHitInGraceWindow(n));
  if (!allHit && nowTs < groupHitTs + graceMs) {
    return;
  }

  const perNotePoints = getPointsPerNote(game);
  if (allHit) {
    const pts = perNotePoints * group.length;
    game.score += pts;
    spawnScorePopups(game, group, perNotePoints, nowTs);
    for (const note of group) {
      note.resolved = true;
      note.hit = true;
      note.captureAnimStartTs = nowTs;
      spawnCaptureEffect(game, note, nowTs);
      if (game.isDirectionActive(note.targetDir)) {
        game.kickEdgeGlow(note.targetDir);
      }
      game.playNote(
        note.midi,
        note.durationMs ?? 220,
        note.velocity ?? 0.85,
        note.instrument ?? "piano",
        note.effects ?? null
      );
    }
    game.streak += group.length;
    const powerModeThreshold = Number.isFinite(game.scoreForceModeThreshold)
      ? Math.max(0, Math.floor(game.scoreForceModeThreshold))
      : 100;
    if (
      game.GAME_MODE !== "dev-record" &&
      !game.powerMode &&
      getPointsPerNote(game) >= powerModeThreshold
    ) {
      game.powerMode = true;
      game.powerModeLabelStartTs = nowTs;
    }
  } else {
    for (const note of group) {
      note.resolved = true;
      if (note.assistOk) {
        note.hit = true;
        game.playNote(
          note.midi,
          note.durationMs ?? 220,
          note.velocity ?? 0.85,
          note.instrument ?? "piano",
          note.effects ?? null
        );
      } else {
        note.hit = false;
      }
    }
    game.streak = 0;
    if (game.powerMode) {
      game.powerMode = false;
    }
    game.registerMissEvent(nowTs);
  }

  for (const note of resolving) {
    if (note.resolved) continue;
    if (nowTs < note.hitTs + graceMs) continue;
    note.resolved = true;
    if (noteIsHitInGraceWindow(note)) {
      note.hit = true;
      note.captureAnimStartTs = nowTs;
      spawnCaptureEffect(game, note, nowTs);
      game.playNote(
        note.midi,
        note.durationMs ?? 220,
        note.velocity ?? 0.85,
        note.instrument ?? "piano",
        note.effects ?? null
      );
    } else {
      note.hit = false;
      game.registerMissEvent(nowTs);
    }
  }
}

export function getPointsPerNote(game) {
  const base = Number.isFinite(game.scoreBasePerNote)
    ? Math.max(0, Math.floor(game.scoreBasePerNote))
    : 10;
  const streakStepEvery = Number.isFinite(game.scoreStreakStepEvery)
    ? Math.max(1, Math.floor(game.scoreStreakStepEvery))
    : 10;
  const streakStepAmount = Number.isFinite(game.scoreStreakStepAmount)
    ? Math.max(0, Math.floor(game.scoreStreakStepAmount))
    : 10;
  const maxPerNote = Number.isFinite(game.scoreMaxPerNote)
    ? Math.max(base, Math.floor(game.scoreMaxPerNote))
    : 100;
  const tier = Math.floor((game.streak || 0) / streakStepEvery);
  return Math.min(maxPerNote, base + tier * streakStepAmount);
}

export function spawnScorePopups(game, group, perNotePoints, nowTs) {
  const byDirHalfAndDrift = new Map();
  const laneToVerticalHalf = (lane) => {
    if (lane === 11 || lane === 21 || lane === 31 || lane === 41) return "TOP";
    if (lane === 12 || lane === 22 || lane === 32 || lane === 42)
      return "BOTTOM";
    if (lane === 51 || lane === 52) return "TOP";
    if (lane === 53 || lane === 54) return "BOTTOM";
    return "TOP";
  };
  const horizontalDriftDirForNote = (note) => {
    const dx = (note?.to?.x || 0) - (note?.from?.x || 0);
    if (dx > 0.01) return -1;
    if (dx < -0.01) return 1;
    return 0;
  };
  for (const note of group) {
    const verticalHalf = laneToVerticalHalf(note.lane);
    const horizontalDriftDir = horizontalDriftDirForNote(note);
    const key = `${note.targetDir}:${verticalHalf}:${horizontalDriftDir}`;
    const cur = byDirHalfAndDrift.get(key);
    byDirHalfAndDrift.set(key, {
      dir: note.targetDir,
      verticalHalf,
      horizontalDriftDir,
      amount: (cur?.amount || 0) + perNotePoints
    });
  }
  const popupTtlMs = Math.max(60, game.captureEffectDurationMs * 1.2);
  const forcePopupByDir = {
    UP: "#9D4EDD",
    RIGHT: "#9D4EDD",
    DOWN: "#9D4EDD",
    LEFT: "#9D4EDD",
    MIDDLE: "#9D4EDD"
  };
  for (const {
    dir,
    verticalHalf,
    horizontalDriftDir,
    amount
  } of byDirHalfAndDrift.values()) {
    const dirColor = game.powerMode
      ? forcePopupByDir[dir] || "#9D4EDD"
      : game.colors[dir] || "#ffffff";
    game.scorePopups.push({
      dir,
      color: dirColor,
      verticalHalf,
      horizontalDriftDir,
      amount,
      startTs: nowTs,
      ttlMs: popupTtlMs
    });
  }
}

export function updateUpcomingNoteAssist(game, layout, nowTs) {
  const upcoming = game.notes
    .filter((n) => !n.resolved && nowTs >= n.startTs && n.hitTs >= nowTs)
    .sort((a, b) => a.hitTs - b.hitTs);
  if (!upcoming.length) return;

  const nextHitTs = upcoming[0].hitTs;
  const group = upcoming.filter((n) => Math.abs(n.hitTs - nextHitTs) < 2);
  if (nextHitTs - nowTs > game.hitAssistWindowMs) return;

  for (const note of group) {
    const pct = game.squareMotionPctLast.get(note.targetDir) || 0;
    if (pct >= game.squareMotionMinPct) {
      note.assistOk = true;
      selectDirection(game, note.targetDir, nowTs);
    } else {
      note.assistOk = note.assistOk || false;
    }
  }
}

export function selectDirection(game, dir, nowTs) {
  if (!dir) return;
  game.lastDirectionActivatedTs ??= new Map();
  game.lastDirectionActivatedTs.set(dir, nowTs);
  if (dir === game.primaryDirection) {
    game.activeDirStates.set(dir, { fadeStartTs: null, intensity: 1 });
    return;
  }
  const prev = game.primaryDirection;
  game.primaryDirection = dir;
  game.activeDirStates.set(dir, { fadeStartTs: null, intensity: 1 });
  if (prev && prev !== dir) {
    game.activeDirStates.set(prev, { fadeStartTs: nowTs, intensity: 1 });
  }
}

export function updateActiveFades(game, nowTs) {
  for (const [dir, state] of Array.from(game.activeDirStates.entries())) {
    if (dir === game.primaryDirection) {
      game.activeDirStates.set(dir, { fadeStartTs: null, intensity: 1 });
      continue;
    }
    if (!state.fadeStartTs) continue;
    const t = (nowTs - state.fadeStartTs) / game.activeFadeMs;
    const intensity = Math.max(0, 1 - t);
    if (intensity <= 0) game.activeDirStates.delete(dir);
    else game.activeDirStates.set(dir, { ...state, intensity });
  }
}

export function isDirectionActive(game, dir) {
  return game.getDirectionIntensity(dir) > 0;
}

export function kickEdgeGlow(game, dir) {
  if (!game.edgeGlowEnabled) return;
  if (!game.edgeGlow) return;
  game.edgeGlowBursts ??= [];
  const spawnBurst = (edge, baseScale, color) => {
    const strength = Math.min(
      1,
      Math.max(
        0.2,
        (game.edgeGlowKick || 1) / Math.max(1, game.edgeGlowMax || 1)
      )
    );
    game.edgeGlowBursts.push({
      dir: edge,
      startTs: performance.now(),
      sizeScale: baseScale,
      color,
      strength,
      seed: Math.random()
    });
  };
  if (dir === "MIDDLE") {
    const c = game.powerMode ? "#7B2CBF" : game.colors.MIDDLE;
    for (const edge of ["UP", "RIGHT", "DOWN", "LEFT"]) {
      const cur = game.edgeGlow.get(edge) || 0;
      game.edgeGlow.set(
        edge,
        Math.min(game.edgeGlowMax, cur + game.edgeGlowKick)
      );
      game.edgeGlowColor?.set(edge, c);
      spawnBurst(edge, 1.0, c);
    }
    return;
  }
  if (!game.edgeGlow.has(dir)) return;
  const cur = game.edgeGlow.get(dir) || 0;
  game.edgeGlow.set(dir, Math.min(game.edgeGlowMax, cur + game.edgeGlowKick));
  const c = game.powerMode ? "#7B2CBF" : game.colors[dir];
  if (c) game.edgeGlowColor?.set(dir, c);
  spawnBurst(dir, 0.5, c || "#7B2CBF");
}

export function decayEdgeGlow(game, dtMs) {
  if (!game.edgeGlowEnabled) return;
  if (!game.edgeGlow) return;
  const configuredHalfLife = Math.max(1, game.edgeGlowHalfLifeMs || 220);
  // Speed up tail decay so long streaks don't pin the glow at a flat plateau.
  const halfLife = Math.max(1, configuredHalfLife * 0.72);
  const decay = Math.pow(0.5, dtMs / halfLife);
  for (const [dir, v] of game.edgeGlow.entries()) {
    const next = (v || 0) * decay;
    game.edgeGlow.set(dir, next < 0.001 ? 0 : next);
  }

  const nowTs = performance.now();
  const fadeMs = Number.isFinite(game.edgeGlowBurstFadeMs)
    ? Math.max(60, game.edgeGlowBurstFadeMs)
    : 520;
  if (Array.isArray(game.edgeGlowBursts)) {
    game.edgeGlowBursts = game.edgeGlowBursts.filter(
      (b) => nowTs - (b.startTs || 0) < fadeMs
    );
  }
}

export function spawnCaptureEffect(game, note, nowTs) {
  if (!note?.to) return;
  const forceRingByDir = {
    UP: "#3C096C",
    RIGHT: "#5A189A",
    DOWN: "#7B2CBF",
    LEFT: "#9D4EDD",
    MIDDLE: "#7B2CBF"
  };
  const color = game.powerMode
    ? forceRingByDir[note.targetDir] || "#9D4EDD"
    : game.colors[note.targetDir] || "#00ffd5";
  const wavePoints = 42;
  const waveProfile = Array.from(
    { length: wavePoints },
    () =>
      game.captureEffectWavePeak + Math.random() * game.captureEffectWaveValley
  );
  game.captureEffects.push({
    x: note.to.x,
    y: note.to.y,
    startTs: nowTs,
    color,
    waveProfile,
    waveTwist: Math.random() * Math.PI * 2
  });
}
