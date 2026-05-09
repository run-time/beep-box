// createSimpleReverbBuffer.js
// Utility to create a simple impulse response buffer for reverb
export function createSimpleReverbBuffer(
  audioCtx,
  duration = 2.0,
  decay = 0.3,
) {
  const rate = audioCtx.sampleRate;
  const length = rate * duration;
  const impulse = audioCtx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      // Exponential decay, random noise
      channel[i] =
        (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 4);
    }
  }
  return impulse;
}
