import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml } from '../src/client/index.ts'

test('会话标题在插入 HTML 前转义文本和属性危险字符', () => {
  const title = '<img src=x onerror=alert(1)>"&\''
  assert.equal(escapeHtml(title), '&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;')
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  assert.match(source, /title="\$\{title\}">\$\{title\}<\/span>/)
  assert.match(source, /wtb-boardName">\$\{escapeHtml\(t\.title\)\}<\/span>/)
})
