// playback-tone.js
// Tone.js-based playback for Note Explorer
// Assumes Tone.js and Tonejs-Instruments.js are loaded via CDN in index.html
// Add this to your HTML before this script:
// <script src="https://unpkg.com/tone@next/build/Tone.js"></script>
// <script src="https://nbrosowsky.github.io/tonejs-instruments/Tonejs-Instruments.js"></script>

// Helper to convert MIDI note number to scientific pitch notation (e.g., 60 -> 'C4')
export function midiToNoteName(midi) {
  if (!Number.isFinite(midi) || midi < 0 || midi > 127) return null;
  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B"
  ];
  const note = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return note + octave;
}

export class NotePlayback {
  constructor() {
    this.sampler = null;
    this.loaded = false;
    this.samplers = new Map();
    this.defaultInstrument = "piano";
    this.supportedInstruments = new Set([
      "bass-electric",
      "bassoon",
      "cello",
      "clarinet",
      "contrabass",
      "flute",
      "french-horn",
      "guitar-acoustic",
      "guitar-electric",
      "guitar-nylon",
      "harmonium",
      "harp",
      "organ",
      "piano",
      "saxophone",
      "trombone",
      "trumpet",
      "tuba",
      "violin",
      "xylophone"
    ]);
    this.instrumentAliases = {
      "nylon guitar": "guitar-nylon",
      "french horn": "french-horn"
    };
    this.reportedFallbacks = new Set();
    this.defaultSamplerVolumeDb = -10;
    this.instrumentVolumeDb = {
      tuba: -14,
      contrabass: -13,
      "bass-electric": -12,
      trombone: -11,
      "french-horn": -11,
      cello: -10,
      bassoon: -10,
      trumpet: -10,
      saxophone: -10,
      organ: -11,
      piano: -9,
      harmonium: -10,
      harp: -10,
      "guitar-acoustic": -10,
      "guitar-electric": -10,
      clarinet: -9,
      flute: -9,
      violin: -9,
      xylophone: -10
    };
    this.scheduledTimeouts = [];
    this.isPaused = false;
    this.currentPlaybackNotes = [];
    this.currentStartTime = 0;
    this.currentOnStatusUpdate = null;
    this.playbackStartWallTime = null; // Wall clock time when playback started
    this.pausedPlaybackTime = 0;
    this.transportStartAudioTime = null;
    this.currentPart = null;
  }

  normalizeInstrumentName(name) {
    if (typeof name !== "string" || !name.trim()) return this.defaultInstrument;
    return name.trim().toLowerCase();
  }

  resolveInstrumentName(name) {
    const normalized = this.normalizeInstrumentName(name);
    if (this.supportedInstruments.has(normalized)) {
      return normalized;
    } else {
      console.warn(
        `Unsupported instrument "${name}" -> using "${this.defaultInstrument}"`
      );
      return this.defaultInstrument;
    }
  }

  async getSampler(instrumentName = this.defaultInstrument) {
    const name = this.resolveInstrumentName(instrumentName);
    if (this.samplers.has(name)) {
      return this.samplers.get(name);
    }
    const loaded = window.SampleLibrary.load({
      instruments: [name],
      baseUrl: "https://nbrosowsky.github.io/tonejs-instruments/samples/",
      minify: true,
      ext: ".mp3"
    });
    let sampler = loaded[name];
    // Fallback to piano for unknown/unsupported instrument names.
    if (!sampler && name !== this.defaultInstrument) {
      return this.getSampler(this.defaultInstrument);
    }
    if (!sampler) return null;
    if (sampler?.volume) {
      const targetDb =
        this.instrumentVolumeDb[name] ?? this.defaultSamplerVolumeDb;
      sampler.volume.value = targetDb;
    }
    sampler.connect(this.reverb);
    this.samplers.set(name, sampler);
    await window.Tone.loaded();
    if (name === this.defaultInstrument && !this.sampler)
      this.sampler = sampler;
    return sampler;
  }

  async triggerNote(
    noteOrMidi,
    duration,
    instrument = this.defaultInstrument,
    velocity = 1
  ) {
    const midi = typeof noteOrMidi === "number" ? noteOrMidi : noteOrMidi?.midi;
    const noteDuration =
      typeof duration === "number" ? duration : noteOrMidi?.duration;
    const noteName = midiToNoteName(midi);
    if (!noteName || !Number.isFinite(noteDuration) || noteDuration <= 0)
      return;
    let instrumentName =
      typeof noteOrMidi === "object" ? noteOrMidi?.instrument : instrument;
    let noteVelocity =
      typeof noteOrMidi === "object" ? noteOrMidi?.velocity : velocity;
    // Backward compatibility for old call order:
    // triggerNote(midi, duration, velocity, instrument)
    if (typeof instrument === "number" && typeof velocity === "string") {
      noteVelocity = instrument;
      instrumentName = velocity;
    }
    const v = Number.isFinite(noteVelocity)
      ? Math.max(0, Math.min(1, noteVelocity))
      : 0.7;
    await this.loadPiano();
    await window.Tone.start();
    const sampler = await this.getSampler(
      instrumentName || this.defaultInstrument
    );
    if (!sampler) return;
    sampler.triggerAttackRelease(noteName, noteDuration, undefined, v);
  }

  async loadInstrument(instrument = this.defaultInstrument) {
    await this.loadPiano();
    await this.getSampler(instrument || this.defaultInstrument);
    return this.samplers.get(this.resolveInstrumentName(instrument));
  }

  // Preload all notes by triggering them silently
  async preloadNotes(notes) {
    await this.waitForSamples();
    const instrumentToNotes = new Map();
    for (const note of notes) {
      const noteName = midiToNoteName(note?.midi);
      if (!noteName) continue;
      const instrument = this.resolveInstrumentName(note?.instrument);
      if (!instrumentToNotes.has(instrument))
        instrumentToNotes.set(instrument, new Set());
      instrumentToNotes.get(instrument).add(noteName);
    }

    for (const instrument of instrumentToNotes.keys()) {
      await this.getSampler(instrument);
    }

    const samplers = Array.from(this.samplers.values());
    const origVolBySampler = new Map();
    const origWet = this.reverb?.wet?.value;
    try {
      // Hard-mute during preload. Some environments still leak audio at -100dB,
      // especially with reverb tails, so disable reverb and use -Infinity.
      for (const sampler of samplers) {
        origVolBySampler.set(sampler, sampler?.volume?.value);
        if (sampler?.volume) sampler.volume.value = -Infinity;
      }
      if (this.reverb?.wet) this.reverb.wet.value = 0;
      for (const [instrument, noteNames] of instrumentToNotes.entries()) {
        const sampler = this.samplers.get(instrument);
        if (!sampler) continue;
        for (const noteName of noteNames) {
          try {
            // Trigger with velocity 0 to force buffer fetch without audible output.
            sampler.triggerAttackRelease(noteName, 0.05, undefined, 0);
          } catch (e) {
            // Ignore errors for missing samples
          }
        }
      }
      // Wait for any sample fetch/decode kicked off by the triggers to fully complete
      // before restoring volume, otherwise you can get a "note smash" burst when buffers finish loading.
      await window.Tone.loaded();
      await new Promise((res) => setTimeout(res, 50));
    } finally {
      for (const sampler of samplers) {
        const origVol = origVolBySampler.get(sampler);
        if (sampler?.volume && typeof origVol === "number") {
          sampler.volume.value = origVol;
        }
      }
      if (this.reverb?.wet && typeof origWet === "number")
        this.reverb.wet.value = origWet;
    }
  }

  async waitForSamples(instrument = this.defaultInstrument) {
    await this.loadInstrument(instrument);
    const sampler = this.samplers.get(this.resolveInstrumentName(instrument));
    if (!sampler) return;
    while (true) {
      const allLoaded = Object.values(sampler.loaded).every((v) => v);
      if (allLoaded) break;
      await new Promise((res) => setTimeout(res, 50));
    }
  }

  async loadPiano() {
    if (this.loaded) return this.sampler;
    // Shared reverb for all instrument samplers.
    this.reverb = new window.Tone.Reverb({
      decay: 1.6,
      preDelay: 0.03,
      wet: 0.12
    });
    this.limiter = new window.Tone.Limiter(-2).toDestination();
    this.reverb.connect(this.limiter);
    this.sampler = await this.getSampler(this.defaultInstrument);
    this.loaded = true;
    console.log("Instrument sampler system loaded with reverb.");
    return this.sampler;
  }

  clearScheduledTimeouts() {
    if (this.currentPart) {
      try {
        this.currentPart.stop(0);
      } catch (e) {
        // Ignore cleanup errors.
      }
      this.currentPart.dispose();
      this.currentPart = null;
    }
    if (window?.Tone?.Transport) {
      window.Tone.Transport.stop();
      window.Tone.Transport.position = 0;
    }
    for (const id of this.scheduledTimeouts) {
      clearTimeout(id);
    }
    this.scheduledTimeouts = [];
  }

  pausePlayback() {
    // Capture current playback time before flipping isPaused.
    this.pausedPlaybackTime = this.getCurrentPlaybackTime();
    this.isPaused = true;
    this.clearScheduledTimeouts();
    this.transportStartAudioTime = null;
    // No way to stop already triggered samples, but future notes won't play
  }

  async playNotesFrom(startTime, playbackNotes, onStatusUpdate, options = {}) {
    await this.loadPiano();
    await window.Tone.start();
    this.clearScheduledTimeouts();
    this.isPaused = false;
    this.currentPlaybackNotes = playbackNotes;
    this.currentStartTime = startTime;
    this.currentOnStatusUpdate = onStatusUpdate;
    this.playbackStartWallTime = Date.now() / 1000;
    this.transportStartAudioTime = window.Tone.now();
    const statusMode = options.statusMode || "chord"; // "chord" | "note"
    // Find all unique chord times (first note per chord)
    const chordMap = new Map();
    const instrumentsToLoad = new Set();
    for (let i = 0; i < playbackNotes.length; ++i) {
      const n = playbackNotes[i];
      if (n.start + 1e-9 < startTime) continue;
      if (!chordMap.has(n.start)) {
        chordMap.set(n.start, i); // store index of first note in chord
      }
      instrumentsToLoad.add(this.resolveInstrumentName(n.instrument));
    }
    await Promise.all(
      Array.from(instrumentsToLoad).map((instrumentName) =>
        this.getSampler(instrumentName)
      )
    );

    const events = [];
    for (let i = 0; i < playbackNotes.length; ++i) {
      const note = playbackNotes[i];
      // When starting mid-song, skip earlier notes entirely (do NOT clamp to 0),
      // otherwise you'll hear all prior notes fire immediately.
      if (note.start + 1e-9 < startTime) continue;
      const noteName = midiToNoteName(note.midi);
      if (!noteName) continue;
      const relStart = note.start - startTime;
      const velocity = Number.isFinite(note.velocity)
        ? Math.max(0, Math.min(1, note.velocity))
        : 0.7;
      events.push({
        time: relStart,
        idx: i,
        note,
        noteName,
        duration: note.duration,
        instrumentName: this.resolveInstrumentName(note.instrument),
        velocity
      });
    }

    this.currentPart = new window.Tone.Part((time, event) => {
      if (this.isPaused) return;
      const sampler =
        this.samplers.get(event.instrumentName) ||
        this.samplers.get(this.defaultInstrument);
      if (sampler) {
        sampler.triggerAttackRelease(
          event.noteName,
          event.duration,
          time,
          event.velocity
        );
      }
      if (!onStatusUpdate) return;
      const shouldNotify =
        statusMode === "note" || chordMap.get(event.note.start) === event.idx;
      if (!shouldNotify) return;
      window.Tone.Draw.schedule(() => {
        onStatusUpdate({ ...event.note, idx: event.idx });
      }, time);
    }, events);

    this.currentPart.start(0);
    window.Tone.Transport.position = 0;
    window.Tone.Transport.start("+0.01");
  }

  getCurrentPlaybackTime() {
    // Returns the current playback time in seconds relative to the start of playback
    if (this.playbackStartWallTime === null) return this.currentStartTime || 0;
    if (this.isPaused) return this.pausedPlaybackTime;
    if (Number.isFinite(this.transportStartAudioTime)) {
      return (
        Math.max(0, window.Tone.now() - this.transportStartAudioTime) +
        this.currentStartTime
      );
    }
    return (
      Date.now() / 1000 - this.playbackStartWallTime + this.currentStartTime
    );
  }
}
