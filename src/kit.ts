// The kit: every drawn part squishys are assembled from, as plain data.
// This file is the kit's shape; the parts themselves live in a data file.
// Pure: nothing here touches Claude Code, so tools outside the mod (the art
// preview) can read the kit too.

import { PLACEHOLDER_KIT } from './placeholder-kit'

/** How seldom a part turns up. */
export type Rarity = 'common' | 'uncommon' | 'rare'

/**
 * A 16x16 pixel grid: 16 rows, top to bottom, of 16 characters each. Each
 * character is a color key looked up in a palette, and `.` is see-through
 * (in a face or accessory, `.` leaves the part beneath showing).
 *
 * The keys every palette colors:
 * `o` outline, `b` body, `h` highlight, `s` shade,
 * `e` eyes, `c` cheeks, `m` mouth,
 * `a` accessory, `d` accessory shade.
 */
export type Grid = readonly string[]

/** The color of each key a grid uses, as 0xRRGGBB. */
export type Colors = Readonly<Record<string, number>>

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

/** A palette: colors for every key, and the colors a shiny gets instead. */
export type Palette = PartBase & { colors: Colors; shiny: Colors }

/** A legendary: drawn whole, with a fixed Name and its own colors. */
export type Legendary = {
  id: string
  name: string
  grid: Grid
  colors: Colors
  shiny: Colors
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

/** The kit the mod ships: placeholder art until the real kit is drawn. */
export const KIT: Kit = PLACEHOLDER_KIT

/** Every species the kit can make: each body with each face, in kit order. */
export function everySpecies(kit: Kit): Species[] {
  return kit.bodies.flatMap(body => kit.faces.map(face => ({ body: body.id, face: face.id })))
}
