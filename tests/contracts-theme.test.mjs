import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root=resolve(import.meta.dirname,'..')
const source=file=>readFileSync(resolve(root,file),'utf8')

test('shared theme defines the same semantic token interface for dark and light', () => {
  const tokens = source('plugins/react-ui/src/theme.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const required = ['canvas', 'surface', 'surface-raised', 'surface-input', 'stroke',
    'stroke-strong', 'text', 'text-secondary', 'text-muted', 'primary', 'primary-hover',
    'on-primary', 'link', 'focus', 'accent-soft', 'accent-ink', 'error', 'success', 'warning']
  const declarations = mode => {
    const rule = [...tokens.matchAll(/\[data-lc-theme\s*=\s*["'](dark|light)["']\]\s*\{([^{}]*)\}/g)]
      .filter(match => match[1] === mode)
    assert.equal(rule.length, 1, mode + ' palette')
    return new Map([...rule[0][2].matchAll(/(--lc-[\w-]+)\s*:\s*([^;{}]+);/g)]
      .map(match => [match[1], match[2].trim()]))
  }
  const dark = declarations('dark'), light = declarations('light')
  assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort())
  for (const name of required) {
    assert.ok(dark.get('--lc-' + name), name + ' missing in Dark')
    assert.ok(light.get('--lc-' + name), name + ' missing in Light')
  }
})

