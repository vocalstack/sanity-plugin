import assert from 'node:assert/strict'
import { test } from 'node:test'

import { workspaceHue, workspaceInitials } from '../dist/workspaceMark.js'

test('a two-word workspace shows the first letter of each word', () => {
  assert.equal(workspaceInitials('Acme studio'), 'AS')
  assert.equal(workspaceInitials('  north   radio  live '), 'NR')
})

test('a one-word workspace shows its first two letters', () => {
  assert.equal(workspaceInitials('Podcast'), 'PO')
  assert.equal(workspaceInitials('X'), 'X')
})

test('punctuation and emoji-only words are skipped', () => {
  assert.equal(workspaceInitials('— Church & choir'), 'CC')
  assert.equal(workspaceInitials('"Évora" talks'), 'ÉT')
  assert.equal(workspaceInitials('   '), '?')
})

test('the same workspace always gets the same colour', () => {
  assert.equal(workspaceHue('ws_1'), workspaceHue('ws_1'))
  const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(workspaceHue))
  assert.ok(seen.size > 2)
})

test('the colours are the Dashboard’s', () => {
  const hues = [252, 200, 160, 128, 85, 40, 12, 330, 296]
  for (const id of ['ws_1', '0b0f6c1e-2f0a-4a53-9d53-7f8f1a2b3c4d', '']) assert.ok(hues.includes(workspaceHue(id)))
  assert.equal(workspaceHue(''), hues[2166136261 % hues.length])
})
