// Regenerates the art preview page from the current kit: `npm run preview`.
// Development only; the mod never loads this.
//
// Node runs the TypeScript modules as they are, with its built-in type
// stripping. The mod's imports leave off the `.ts` extension (the engine
// and tsc resolve them like a bundler), so a small resolve hook adds it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relativeWithoutExtension = /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)
    return nextResolve(relativeWithoutExtension ? `${specifier}.ts` : specifier, context)
  },
})

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const SEED = 1
const SAMPLES = 24

const { KIT } = await import('../../src/kit.ts')
const { previewItems } = await import('./items.ts')
const { previewPage } = await import('./page.ts')

const items = previewItems(KIT, { samples: SAMPLES, seed: SEED })
const html = previewPage(items, {
  generatedAt: new Date(),
  seed: SEED,
  script: readFileSync(join(here, 'client.js'), 'utf8'),
})

const out = join(root, 'out', 'art-preview.html')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`Wrote ${relative(process.cwd(), out)}: ${items.length} items, ${Math.round(html.length / 1024)} KB`)
