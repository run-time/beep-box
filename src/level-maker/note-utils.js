// note-utils.js
// Helper and logic functions for Beep Box Level Maker

// Sort and format note table as specified
export function sortAndFormatNotesTable(text) {
  function format3(x) {
    if (!Number.isFinite(x)) return "";
    // Round to 3 decimals, then trim trailing zeros/dot.
    return x.toFixed(3).replace(/\.?0+$/, "");
  }

  function isSplitLaneFormat(cols) {
    // | track | instrument | lane | key | ... | velocity | duration | time | [spawn] |
    return (
      cols.length >= 8 &&
      cols[1] &&
      !cols[1].startsWith("note_") &&
      /^\d+$/.test(cols[2] || "") &&
      /^\d+$/.test(cols[3] || "")
    );
  }

  function getRowIndexes(cols) {
    if (isSplitLaneFormat(cols)) {
      return {
        instrument: 1,
        lane: 2,
        key: 3,
        vel: 5,
        dur: 6,
        time: 7,
        spawn: 8
      };
    }
    return {
      instrument: null,
      lane: null,
      key: 2,
      vel: 4,
      dur: 5,
      time: 6,
      spawn: 7
    };
  }

  function normalizeRowToSplitWithSpawn(cols) {
    // Returns { cols, idx: {key, vel, dur, time, spawn} } with lane split and spawn present.
    let out = cols.slice();
    let split = isSplitLaneFormat(out);

    if (!split) {
      // Old format: | track | note_XX | key | ... | velocity | duration | time |
      const ev = out[1] || "note_00";
      const lane = (ev.match(/^note_(\d\d)$/) || [])[1] || "00";
      out[1] = "piano";
      out.splice(2, 0, lane);
      split = true;
    }

    // Ensure spawn column exists at end (default 1s).
    // In split format, time is at index 7; if there are only 8 cols, spawn is missing.
    if (out.length === 8) out.push("1");

    return { cols: out, idx: getRowIndexes(out) };
  }

  const lines = text.split(/\r?\n/);
  // Remove header rows (lines with non-numeric 3rd column)
  const dataRows = lines.filter((line) => {
    const cols = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
    if (cols.length < 7) return false;
    if (isSplitLaneFormat(cols)) return /^\d+$/.test(cols[3] || "");
    return /^\d+$/.test(cols[2] || "");
  });
  // Parse rows into objects
  const parsed = dataRows.map((line) => {
    const cols = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
    // Normalize event type (old format only)
    if (cols[1] === "note_on") cols[1] = "note_00";
    const norm = normalizeRowToSplitWithSpawn(cols);
    return {
      raw: norm.cols,
      time: parseFloat(norm.cols[norm.idx.time])
    };
  });
  // Sort by last column (time)
  parsed.sort((a, b) => a.time - b.time);
  // Find minimum time value
  const minTime = parsed.length > 0 ? parsed[0].time : 0;
  // Group by time, add empty line after each group, and shift times
  let out = [];
  let lastTime = null;
  for (let i = 0; i < parsed.length; ++i) {
    const row = parsed[i];
    const idx = normalizeRowToSplitWithSpawn(row.raw).idx;
    // Shift the time value in the last column
    let shiftedRaw = row.raw.slice();
    const origVelocity = parseFloat(shiftedRaw[idx.vel]);
    if (!isNaN(origVelocity)) shiftedRaw[idx.vel] = format3(origVelocity);
    const origDuration = parseFloat(shiftedRaw[idx.dur]);
    if (!isNaN(origDuration)) shiftedRaw[idx.dur] = format3(origDuration);
    let origTime = parseFloat(shiftedRaw[idx.time]);
    if (!isNaN(origTime)) {
      let shifted = origTime - minTime;
      shifted = Math.abs(shifted) < 1e-10 ? 0 : shifted;
      shiftedRaw[idx.time] = format3(shifted);
    }
    out.push("| " + shiftedRaw.join(" | ") + " |");
    const next = parsed[i + 1];
    if (!next || next.time !== row.time) {
      out.push(""); // empty line after group
    }
  }
  return out.join("\n");
}

// Convert piano key number (1-88) to MIDI note number (A0=21, C8=108)
export function pianoKeyToMidi(keyNum) {
  keyNum = Math.max(1, Math.min(88, keyNum));
  return 21 + (keyNum - 1);
}

// MIDI note number to frequency
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Gather song metadata from textarea
export function gatherSongMetadata(text) {
  const lines = text.split(/\r?\n/);
  let noteCount = 0;
  let chordCount = 0;
  let lastTime = null;
  let tracks = new Set();
  for (const line of lines) {
    const cols = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
    if (cols.length < 7) continue;
    const isSplit =
      cols.length >= 8 &&
      cols[1] &&
      !cols[1].startsWith("note_") &&
      /^\d+$/.test(cols[2] || "") &&
      /^\d+$/.test(cols[3] || "");
    const keyIdx = isSplit ? 3 : 2;
    const timeIdx = isSplit ? 7 : 6;
    if (!/^\d+$/.test(cols[keyIdx] || "")) continue;
    const midi = parseInt(cols[keyIdx], 10);
    if (!Number.isFinite(midi) || midi < 21 || midi > 108) continue;
    noteCount++;
    tracks.add(cols[0]);
    const time = parseFloat(cols[timeIdx]);
    if (lastTime === null || time !== lastTime) {
      chordCount++;
      lastTime = time;
    }
  }
  return {
    noteCount,
    chordCount,
    trackCount: tracks.size,
    tracks: Array.from(tracks),
    duration: lastTime || 0
  };
}

// Parse input into notes
export function parseInput(text) {
  const lines = text.split(/\r?\n/);
  const notes = [];
  let rowLineMap = [];
  let noteLineMap = [];
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const cols = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
    if (cols.length < 7) continue;
    const isSplit =
      cols.length >= 8 &&
      cols[1] &&
      !cols[1].startsWith("note_") &&
      /^\d+$/.test(cols[2] || "") &&
      /^\d+$/.test(cols[3] || "");
    const instrumentIdx = isSplit ? 1 : null;
    const keyIdx = isSplit ? 3 : 2;
    const durIdx = isSplit ? 6 : 5;
    const timeIdx = isSplit ? 7 : 6;
    if (!/^\d+$/.test(cols[keyIdx] || "")) continue;
    const midi = parseInt(cols[keyIdx], 10); // MIDI note number
    // For piano range, accept A0 (21) through C8 (108). Ignore out of range.
    if (midi < 21 || midi > 108) continue;
    const duration = parseFloat(cols[durIdx]);
    const start = parseFloat(cols[timeIdx]);
    const instrument =
      instrumentIdx !== null ? cols[instrumentIdx] || "piano" : "piano";
    if (!isNaN(midi) && !isNaN(duration) && !isNaN(start)) {
      notes.push({ midi, duration, start, instrument, lineIdx: i, raw: line });
      rowLineMap.push(i);
      noteLineMap.push(i);
    }
  }
  return { notes, rowLineMap, noteLineMap };
}

// Normalize start times
export function normalizeStartTimes(notes) {
  if (notes.length === 0) return notes;
  const minStart = Math.min(...notes.map((n) => n.start));
  return notes.map((n) => ({ ...n, start: n.start - minStart }));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  if (total <= 0) return entries[0]?.[0] ?? null;
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

export function insertNotesForChords(text, options = {}) {
  const holdSecondsMin = options.holdSecondsMin ?? 1;
  const holdSecondsMax = options.holdSecondsMax ?? 2;
  const minGapSecondsToSwitch = options.minGapSecondsToSwitch ?? 0.4;
  const seed = options.seed ?? 1337;

  const lines = text.split(/\r?\n/);
  const parsedRows = [];
  const notes = [];

  function isSplitLaneFormat(cols) {
    return (
      cols.length >= 8 &&
      cols[1] &&
      !cols[1].startsWith("note_") &&
      /^\d+$/.test(cols[2] || "") &&
      /^\d+$/.test(cols[3] || "")
    );
  }

  function setRowLane(row, laneNumber) {
    if (!row || !row.cols || row.cols.length < 2) return;
    const laneStr = String(laneNumber).padStart(2, "0");
    if (isSplitLaneFormat(row.cols)) {
      row.cols[1] = row.cols[1] || "piano";
      row.cols[2] = laneStr;
    } else {
      row.cols[1] = `note_${laneStr}`;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cols = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
    parsedRows.push({ cols, original: line });
    if (cols.length < 7) continue;
    // Support both lane formats; key is MIDI note number.
    const isSplit =
      cols.length >= 8 &&
      cols[1] &&
      !cols[1].startsWith("note_") &&
      /^\d+$/.test(cols[2] || "") &&
      /^\d+$/.test(cols[3] || "");
    const keyIdx = isSplit ? 3 : 2;
    const timeIdx = isSplit ? 7 : 6;
    if (!/^\d+$/.test(cols[keyIdx] || "")) continue;
    const midi = parseInt(cols[keyIdx], 10);
    if (!Number.isFinite(midi) || midi < 21 || midi > 108) continue;
    const time = parseFloat(cols[timeIdx]);
    if (!Number.isFinite(midi) || !Number.isFinite(time)) continue;
    notes.push({ lineIdx: i, midi, time });
  }

  // Group notes by chord time (same timestamp).
  const chordMap = new Map();
  for (const n of notes) {
    const key = n.time;
    if (!chordMap.has(key)) chordMap.set(key, []);
    chordMap.get(key).push(n);
  }
  const chordTimes = Array.from(chordMap.keys()).sort((a, b) => a - b);
  const chords = chordTimes
    .map((t) => ({ time: t, notes: chordMap.get(t) }))
    .filter((c) => c.notes.length >= 3);

  if (chords.length === 0) return text;

  // Precompute chord pitch range (avg of min/max).
  const chordPitches = chords.map((c) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of c.notes) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    return (lo + hi) / 2;
  });
  const minPitch = Math.min(...chordPitches);
  const maxPitch = Math.max(...chordPitches);
  const pitchSpan = Math.max(1e-9, maxPitch - minPitch);

  const lanesByTarget = {
    UP: [11, 12],
    LEFT: [21, 22],
    RIGHT: [31, 32],
    DOWN: [41, 42],
    MIDDLE: [51, 52, 53, 54]
  };

  function chooseTarget(norm, rng) {
    // Higher chords bias UP, lower chords bias DOWN, mids prefer MIDDLE a bit.
    const up = 0.2 + norm * 1.8;
    const down = 0.2 + (1 - norm) * 1.8;
    const middle = 0.6;
    const side = 0.4;
    return weightedPick(rng, [
      ["UP", up],
      ["DOWN", down],
      ["MIDDLE", middle],
      ["LEFT", side],
      ["RIGHT", side]
    ]);
  }

  // Reset all lane assignments first so only chosen notes become visible.
  for (const n of notes) {
    const row = parsedRows[n.lineIdx];
    if (!row || row.cols.length < 2) continue;
    setRowLane(row, 0);
  }

  let currentTarget = null;
  let laneStartTime = -Infinity;
  let holdSeconds = 0;
  let lastAssignedChordTime = -Infinity;

  for (let chordIdx = 0; chordIdx < chords.length; chordIdx++) {
    const chord = chords[chordIdx];
    const chordTime = chord.time;

    const pitch = chordPitches[chordIdx];
    const norm = clamp01((pitch - minPitch) / pitchSpan);
    const rng = mulberry32(
      seed ^ (Math.floor(chordTime * 1000) + chordIdx * 101)
    );

    const canSwitchByDuration = chordTime - laneStartTime >= holdSeconds;
    const canSwitchByGap =
      chordTime - lastAssignedChordTime >= minGapSecondsToSwitch;
    if (currentTarget === null || (canSwitchByDuration && canSwitchByGap)) {
      currentTarget = chooseTarget(norm, rng);
      laneStartTime = chordTime;
      holdSeconds =
        holdSecondsMin + rng() * Math.max(0, holdSecondsMax - holdSecondsMin);
    }

    const laneOptions = lanesByTarget[currentTarget] || lanesByTarget.MIDDLE;
    const laneA = laneOptions[0];
    const laneB =
      laneOptions.length > 1
        ? laneOptions[1 + (chordIdx % (laneOptions.length - 1))]
        : laneA;

    // Identify lowest/highest note in chord (by midi); tie-break by line index.
    let lowest = null;
    let highest = null;
    for (const n of chord.notes) {
      if (
        lowest === null ||
        n.midi < lowest.midi ||
        (n.midi === lowest.midi && n.lineIdx < lowest.lineIdx)
      ) {
        lowest = n;
      }
      if (
        highest === null ||
        n.midi > highest.midi ||
        (n.midi === highest.midi && n.lineIdx < highest.lineIdx)
      ) {
        highest = n;
      }
    }
    if (!lowest || !highest) continue;
    if (lowest.lineIdx === highest.lineIdx) continue;

    // Only assign on every other 3+ chord (reduces density).
    if (chordIdx % 2 === 1) {
      continue;
    }

    // 33% lowest only, 33% highest only, 34% both.
    const assignmentRoll = rng();
    const assignLowest = assignmentRoll < 0.33 || assignmentRoll >= 0.66;
    const assignHighest = assignmentRoll >= 0.33;

    const rowLow = parsedRows[lowest.lineIdx];
    const rowHigh = parsedRows[highest.lineIdx];
    if (assignLowest) setRowLane(rowLow, laneA);
    if (assignHighest) setRowLane(rowHigh, laneB);

    lastAssignedChordTime = chordTime;
  }

  // Re-emit lines, preserving any non-table lines as-is.
  const outLines = parsedRows.map((r) => {
    if (!r.cols || r.cols.length < 7) return r.original;
    return "| " + r.cols.join(" | ") + " |";
  });
  return outLines.join("\n");
}

export function clearInsertedNotes(text) {
  const lines = text.split(/\r?\n/);
  const out = lines.map((line) => {
    const cols = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
    if (cols.length < 2) return line;
    const isSplit =
      cols.length >= 8 &&
      cols[1] &&
      !cols[1].startsWith("note_") &&
      /^\d+$/.test(cols[2] || "") &&
      /^\d+$/.test(cols[3] || "");
    if (isSplit) {
      cols[1] = cols[1] || "piano";
      cols[2] = "00";
    } else if (cols[1]?.startsWith("note_")) {
      cols[1] = "note_00";
    }
    if (cols.length < 7) return line;
    return "| " + cols.join(" | ") + " |";
  });
  return out.join("\n");
}
