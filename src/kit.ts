// The kit: every drawn part squishys are assembled from, as plain data.
// This file is the kit's shape; the parts themselves live in a data file.
// Pure: nothing here touches Claude Code, so tools outside the mod (the art
// preview) can read the kit too.

import { DRAWN_KIT } from './drawn-kit'

/** How seldom a part turns up. */
export type Rarity = 'common' | 'uncommon' | 'rare'

/**
 * A square pixel grid, PICTURE_SIZE (composer.ts) rows top to bottom, of
 * as many characters each. Each character is a key for one of the
 * squishy's colors, and `.` is see-through (in a face or accessory, `.`
 * leaves the part beneath showing). See KEY_COLORS for the keys.
 */
export type Grid = readonly string[]

/**
 * A squishy's four colors, as on a Game Boy Color sprite, each 0xRRGGBB.
 * Eyes and mouth are drawn in the outline color and blush in the dark one.
 */
export type Colors = Readonly<{ outline: number; dark: number; base: number; highlight: number }>

/**
 * A shiny's colors: its own three shades (the outline usually stays), and a
 * fifth color, sparkle, for its glints.
 */
export type ShinyColors = Colors & Readonly<{ sparkle: number }>

/**
 * Which color each key a grid may use draws in. Accessories use the same
 * keys, so they come in the squishy's colors too.
 *
 * `o` outline, `e` eye and `m` mouth: the outline color. The composer finds
 * the eyes by their key (to shut them, for one).
 * `d` dark and `c` cheek (blush): the dark color.
 * `b` base, the body's fill: the base color.
 * `h` highlight: the highlight color.
 * `*` glint: the sparkle color on a shiny, the highlight color otherwise.
 */
export const KEY_COLORS: Readonly<Record<string, keyof ShinyColors>> = {
  o: 'outline',
  e: 'outline',
  m: 'outline',
  d: 'dark',
  c: 'dark',
  b: 'base',
  h: 'highlight',
  '*': 'sparkle',
}

/** What every part has: an id, a rarity and its fragment of a Name. */
export type PartBase = {
  /** Unique within its kind, and stable: identity keys are built from it. */
  id: string
  rarity: Rarity
  /** This part's fragment of a squishy's Name; may be empty. */
  syllable: string
}

/** A body: the squishy's outline and fill, drawn first. */
export type Body = PartBase & { grid: Grid }

/** A face, drawn over the body. */
export type Face = PartBase & { grid: Grid }

/** An accessory, drawn over the face. The "none" accessory is all `.`. */
export type Accessory = PartBase & { grid: Grid }

/** A palette: a squishy's four colors, and the colors a shiny gets instead. */
export type Palette = PartBase & { colors: Colors; shiny: ShinyColors }

/** A legendary: drawn whole, with a fixed Name and its own colors. */
export type Legendary = {
  id: string
  name: string
  grid: Grid
  colors: Colors
  shiny: ShinyColors
}

/**
 * A species: the body and face that make one. The kit's starters are
 * species, offered to a new user as their first partner.
 */
export type Species = { body: string; face: string }

export type Kit = {
  bodies: readonly Body[]
  faces: readonly Face[]
  palettes: readonly Palette[]
  accessories: readonly Accessory[]
  legendaries: readonly Legendary[]
  starters: readonly Species[]
}

/** The kit the mod ships. */
export const KIT: Kit = DRAWN_KIT

/** Every species the kit can make: each body with each face, in kit order. */
export function everySpecies(kit: Kit): Species[] {
  return kit.bodies.flatMap(body => kit.faces.map(face => ({ body: body.id, face: face.id })))
}
