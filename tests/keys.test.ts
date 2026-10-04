// Hotkeys, tested directly: plain data in, keys out.

import { expect, test } from 'claude-code/testing'

import { cycleLabel, nextOf, pickKeys } from '../src/keys'

test('picks take the digits in order, then the letters the mode leaves free, then none', () => {
  expect(pickKeys(3, ['o'])).toEqual(['1', '2', '3'])
  expect(pickKeys(12, ['a', 'c'])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'b', 'd', 'e'])
  const all = pickKeys(40, [])
  expect(all.slice(9, 35).join('')).toBe('abcdefghijklmnopqrstuvwxyz')
  expect(all.slice(35)).toEqual([undefined, undefined, undefined, undefined, undefined])
  expect(pickKeys(0, [])).toEqual([])
})

test('a stepping control steps to the next choice, wraps around, and starts over from one it no longer offers', () => {
  const cycle = ['as-started', 'haiku', 'sonnet']
  expect(nextOf(cycle, 'as-started')).toBe('haiku')
  expect(nextOf(cycle, 'sonnet')).toBe('as-started')
  expect(nextOf(cycle, 'opus')).toBe('as-started')
  expect(nextOf(['only'], 'only')).toBe('only')
  expect(nextOf([], 'any')).toBeUndefined()
})

test('from a choice the cycle no longer offers, a press steps to the first offered after it in the full order', () => {
  const order = ['as-started', 'haiku', 'sonnet', 'opus', 'fable']
  expect(nextOf(['as-started', 'haiku', 'fable'], 'sonnet', order)).toBe('fable')
  expect(nextOf(['as-started', 'haiku'], 'opus', order)).toBe('as-started')
})

test('a stepping control’s label says what it’s on, then what the next press picks', () => {
  expect(cycleLabel('model', 'opus', 'sonnet')).toBe('model  opus ▸ sonnet')
})
