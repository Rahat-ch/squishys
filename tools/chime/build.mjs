// Writes sounds/chime.wav, the chime the mod plays on a shiny or legendary
// roll (with the chime setting on, on macOS): two bell-like notes, a fifth
// apart, made here from sine waves, so the clip is the repo's own (MIT,
// like the rest) and stays tiny. Development only: the mod plays the WAV
// and never loads this. Run it with `node tools/chime/build.mjs`.

import { writeFileSync } from 'node:fs'

const RATE = 16_000
const SECONDS = 0.5
const GAIN = 0.35
// E6 then B6, the second a moment after the first
const NOTES = [
  { hz: 1318.51, at: 0 },
  { hz: 1975.53, at: 0.08 },
]
const ATTACK_SECONDS = 0.004
const DECAY_PER_SECOND = 9
const FADE_SECONDS = 0.02

const samples = Math.round(RATE * SECONDS)
const pcm = new Int16Array(samples)
for (let i = 0; i < samples; i += 1) {
  const t = i / RATE
  let value = 0
  for (const { hz, at } of NOTES) {
    const since = t - at
    if (since < 0) continue
    const envelope = Math.min(1, since / ATTACK_SECONDS) * Math.exp(-DECAY_PER_SECOND * since)
    // A touch of the octave above, for a bell's shimmer
    value += envelope * (Math.sin(2 * Math.PI * hz * since) + 0.25 * Math.sin(4 * Math.PI * hz * since))
  }
  // A short fade at the very end, so the clip never stops on a click
  const tail = Math.min(1, (SECONDS - t) / FADE_SECONDS)
  pcm[i] = Math.round(Math.max(-1, Math.min(1, (value * GAIN * tail) / 1.25)) * 32767)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.byteLength, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16) // the fmt chunk's size
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(1, 22) // mono
header.writeUInt32LE(RATE, 24)
header.writeUInt32LE(RATE * 2, 28) // bytes per second
header.writeUInt16LE(2, 32) // bytes per sample
header.writeUInt16LE(16, 34) // bits per sample
header.write('data', 36)
header.writeUInt32LE(pcm.byteLength, 40)

const out = new URL('../../sounds/chime.wav', import.meta.url)
writeFileSync(out, Buffer.concat([header, Buffer.from(pcm.buffer)]))
console.log(`Wrote ${out.pathname}`)
