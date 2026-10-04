// The share card: a squishy drawn large and crisp on a colored card, with
// its Name, badges for its rarity, shininess or legend, and a footer naming
// squishys, as a bitmap the PNG encoder (src/png.ts) writes out. Pure: it
// takes the kit and a squishy as plain data and never touches Claude Code.

import { stillPixels } from './composer'
import { CROWN, GLYPHS, GLYPH_ROWS, MISSING, SPARKLE } from './card-font'
import type { Kit, Rarity } from './kit'
import type { Bitmap } from './png'
import type { Pixels } from './raster'
import { withoutShinyMark } from './roller'
import type { Squishy } from './roller'

/** A card: its bitmap, and where the squishy's picture sits on it, each picture pixel `scale` card pixels each way. */
export type Card = Bitmap & { art: { left: number; top: number; scale: number } }

/**
 * About how wide the picture is drawn, in card pixels: each picture pixel
 * becomes a whole number of card pixels, as many as fit, so a 16-pixel
 * picture is drawn 30 to a pixel and a 10-pixel one 48.
 */
const ART_WIDTH = 480
/** The card's margin round the picture's panel and the text. */
const PADDING = 60
/** How far the panel behind the picture reaches past it, and its corners' radius. */
const PANEL_INSET = 18
const PANEL_RADIUS = 16

/** The largest the Name is drawn, in card pixels to a font pixel; a long Name is drawn smaller. */
const NAME_SCALE = 6
const BADGE_SCALE = 3
const BADGE_PADDING = { across: 14, down: 10 }
const BADGE_GAP = 14
const FOOTER_TITLE_SCALE = 4
const FOOTER_LINE_SCALE = 2
/** The rows of the font a capital takes: badges, all capitals, are no taller. */
const CAP_ROWS = 7

/** Gaps down the card, in card pixels: under the panel, the Name, the badges and between the footer's lines; and the foot. */
const GAPS = { panel: 36, name: 20, badges: 40, footer: 10, foot: 44 }

/** The footer: what squishys is. */
export const FOOTER_TITLE = 'squishys'
export const FOOTER_LINE = "a companion mod for Claude Code's agents"

/** The color the Name and footer title are written in. */
export const INK_COLOR = 0x2a2238
const MUTED_INK = 0x6b6478
const PANEL_COLOR = 0xfffdf8
const BADGE_TEXT = 0xffffff
/** The crown on a legendary's badge. */
export const CROWN_COLOR = 0xf2a900
/** The ✨ before a shiny's Name: a warm yellow. */
export const SPARKLE_COLOR = 0xffd23f

/** The card's own color, by the squishy's rarity, or gold for a legendary. */
const CARD_COLORS: Readonly<Record<Standing, number>> = {
  common: 0xf3efe6,
  uncommon: 0xe2f1e4,
  rare: 0xe0e9f8,
  legendary: 0xf6ebc6,
}

/** The badges' colors. */
const BADGE_COLORS: Readonly<Record<Standing | 'shiny', number>> = {
  common: 0x7a7468,
  uncommon: 0x2f8a57,
  rare: 0x2f63c0,
  legendary: 0x6a3fb0,
  shiny: 0x1f2a44,
}

/** Glyphs drawn in a color of their own, whatever the text's: a shiny's ✨ in SPARKLE_COLOR. */
const GLYPH_COLORS: Readonly<Record<string, number>> = { [SPARKLE]: SPARKLE_COLOR, [CROWN]: CROWN_COLOR }

/** Characters drawn as nothing at all: the emoji presentation selector that may follow ✨. */
const UNDRAWN = new Set(['️', '‍'])

type Badge = { text: string; color: number }

/** A squishy's share card, from its still picture. */
export function shareCard(kit: Kit, squishy: Squishy): Card {
  return drawCard(stillPixels(kit, squishy), squishy)
}

/**
 * The card for a picture of any size: the picture scaled up by whole steps
 * to about ART_WIDTH (nearest neighbor, so it stays crisp) on a panel, then
 * the squishy's Name, its badges and the footer, centered beneath.
 */
export function drawCard(picture: Pixels, squishy: Squishy): Card {
  const side = Math.max(1, picture.length, ...picture.map(row => row.length))
  const scale = Math.max(1, Math.floor(ART_WIDTH / side))
  const art = side * scale
  const width = art + 2 * PADDING
  const room = width - 2 * PADDING

  const name = nameOf(squishy)
  const nameScale = fittedScale(name, NAME_SCALE, room)
  const badges = badgesOf(squishy)
  const badgeHeight = CAP_ROWS * BADGE_SCALE + 2 * BADGE_PADDING.down
  const badgeWidths = badges.map(badge => textWidth(badge.text, BADGE_SCALE) + 2 * BADGE_PADDING.across)
  const lineScale = fittedScale(FOOTER_LINE, FOOTER_LINE_SCALE, room)

  const nameTop = PADDING + art + PANEL_INSET + GAPS.panel
  const badgesTop = nameTop + GLYPH_ROWS * nameScale + GAPS.name
  const titleTop = badgesTop + badgeHeight + GAPS.badges
  const lineTop = titleTop + CAP_ROWS * FOOTER_TITLE_SCALE + GAPS.footer
  const height = lineTop + GLYPH_ROWS * lineScale + GAPS.foot

  const card = canvas(width, height, CARD_COLORS[standingOf(squishy)])
  roundedRect(card, PADDING - PANEL_INSET, PADDING - PANEL_INSET, art + 2 * PANEL_INSET, art + 2 * PANEL_INSET, PANEL_RADIUS, PANEL_COLOR)
  picture.forEach((row, y) =>
    row.forEach((pixel, x) => {
      if (pixel !== null) fill(card, PADDING + x * scale, PADDING + y * scale, scale, scale, pixel)
    }),
  )
  centeredText(card, name, nameTop, nameScale, INK_COLOR)
  const badgesWidth = badgeWidths.reduce((sum, each) => sum + each, 0) + BADGE_GAP * (badges.length - 1)
  let left = Math.floor((width - badgesWidth) / 2)
  badges.forEach((badge, index) => {
    const badgeWidth = badgeWidths[index] ?? 0
    roundedRect(card, left, badgesTop, badgeWidth, badgeHeight, Math.floor(badgeHeight / 2), badge.color)
    text(card, badge.text, left + BADGE_PADDING.across, badgesTop + BADGE_PADDING.down, BADGE_SCALE, BADGE_TEXT)
    left += badgeWidth + BADGE_GAP
  })
  centeredText(card, FOOTER_TITLE, titleTop, FOOTER_TITLE_SCALE, INK_COLOR)
  centeredText(card, FOOTER_LINE, lineTop, lineScale, MUTED_INK)
  return { ...card, art: { left: PADDING, top: PADDING, scale } }
}

/**
 * The Name as the card writes it: a shiny's SHINY_MARK (an emoji the font
 * can't draw) as the font's pixel sparkle.
 */
function nameOf(squishy: Squishy): string {
  const bare = withoutShinyMark(squishy.name)
  return squishy.shiny ? `${SPARKLE} ${bare}` : bare
}

/** What sets a card's color and its first badge: legendary, or the squishy's rarity. */
type Standing = Rarity | 'legendary'

function standingOf(squishy: Squishy): Standing {
  return squishy.kind === 'legendary' ? 'legendary' : squishy.rarity
}

/** The badges: legendary (crowned) or the rarity, then shiny. */
function badgesOf(squishy: Squishy): Badge[] {
  const standing = standingOf(squishy)
  const first: Badge = { text: standing === 'legendary' ? `${CROWN} LEGENDARY` : standing.toUpperCase(), color: BADGE_COLORS[standing] }
  return squishy.shiny ? [first, { text: `${SPARKLE} SHINY`, color: BADGE_COLORS.shiny }] : [first]
}

type Canvas = Bitmap

function canvas(width: number, height: number, color: number): Canvas {
  return { width, height, pixels: new Uint32Array(width * height).fill(color) }
}

function fill(card: Canvas, left: number, top: number, width: number, height: number, color: number): void {
  for (let y = Math.max(0, top); y < Math.min(card.height, top + height); y += 1) {
    card.pixels.fill(color, y * card.width + Math.max(0, left), y * card.width + Math.min(card.width, left + width))
  }
}

/** A rectangle with its corners rounded to `radius`. */
function roundedRect(card: Canvas, left: number, top: number, width: number, height: number, radius: number, color: number): void {
  for (let y = 0; y < height; y += 1) {
    // How far in from each side this row's corner curve starts
    const fromEdge = Math.min(y, height - 1 - y)
    const inset = fromEdge >= radius ? 0 : Math.ceil(radius - Math.sqrt(radius * radius - (radius - fromEdge - 0.5) ** 2))
    fill(card, left + inset, top + y, width - 2 * inset, 1, color)
  }
}

/** The glyphs of a text, as the font draws them: each character's, a missing one's as MISSING. */
function glyphsOf(line: string): { rows: readonly string[]; character: string }[] {
  return [...line].filter(character => !UNDRAWN.has(character)).map(character => ({ character, rows: GLYPHS[character] ?? GLYPHS[MISSING] ?? [] }))
}

/** How wide a text is drawn at `scale`: its glyphs a font pixel apart. */
function textWidth(line: string, scale: number): number {
  const glyphs = glyphsOf(line)
  const columns = glyphs.reduce((sum, glyph) => sum + (glyph.rows[0]?.length ?? 0), 0) + Math.max(0, glyphs.length - 1)
  return columns * scale
}

/** The largest scale up to `largest` a text fits `room` at; 1 at the least. */
function fittedScale(line: string, largest: number, room: number): number {
  for (let scale = largest; scale > 1; scale -= 1) if (textWidth(line, scale) <= room) return scale
  return 1
}

function centeredText(card: Canvas, line: string, top: number, scale: number, color: number): void {
  text(card, line, Math.floor((card.width - textWidth(line, scale)) / 2), top, scale, color)
}

/** Writes a text from its top left corner, each font pixel `scale` card pixels each way. */
function text(card: Canvas, line: string, left: number, top: number, scale: number, color: number): void {
  let x = left
  for (const { character, rows } of glyphsOf(line)) {
    const glyphColor = GLYPH_COLORS[character] ?? color
    rows.forEach((row, y) =>
      [...row].forEach((key, column) => {
        if (key === '#') fill(card, x + column * scale, top + y * scale, scale, scale, glyphColor)
      }),
    )
    x += ((rows[0]?.length ?? 0) + 1) * scale
  }
}
