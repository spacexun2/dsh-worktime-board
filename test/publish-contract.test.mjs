// publish-contract.test.mjs — 发布契约回归测试
//
// 背景（i7：scope-name-closure）：插件包名在 npm 上的真实发布名是 dsh-worktime-board，
// 历史上多处曾硬编码虚构作用域（dsh-external 命名空间，npm 404），
// 导致安装即崩。本测试锁定"六处名称全部一致"的发布契约：
//   package.json.name / cordis.patch.yml insert.name / src/index.ts export name /
//   tsdown PLUGIN_ID / 编译产物（lib/index.js + lib/client.js banner id）/ lib d.ts
// 纯 fs 文本解析 + 正则提取，零依赖；任一不一致时输出全部实际值。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = 'dsh-worktime-board'

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 提取所有命中的第一个 name 引号值。 */
const firstQuoted = (text, regex) => {
  const m = text.match(regex)
  return m === null ? null : m[1]
}

// 各来源 → 提取规则。键 = 展示名，值 = { 路径, 正则 }。
const SOURCES = {
  'package.json.name': {
    path: 'package.json',
    extract: (t) => JSON.parse(t).name ?? null,
  },
  'cordis.patch.yml insert[0].name': {
    path: 'cordis.patch.yml',
    extract: (t) => firstQuoted(t, /name:\s*'([^']+)'/m),
  },
  "src/index.ts export const name": {
    path: 'src/index.ts',
    extract: (t) => firstQuoted(t, /export\s+const\s+name\s*=\s*'([^']+)'/m),
  },
  'tsdown.config.ts PLUGIN_ID': {
    path: 'tsdown.config.ts',
    extract: (t) => firstQuoted(t, /const\s+PLUGIN_ID\s*=\s*"([^"]+)"/m),
  },
  "lib/index.js export const name": {
    path: 'lib/index.js',
    extract: (t) => firstQuoted(t, /export\s+const\s+name\s*=\s*'([^']+)'/m),
  },
  'lib/client.js banner id': {
    path: 'lib/client.js',
    extract: (t) => firstQuoted(t, /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/m),
  },
  'lib/types/index.d.ts declare const name': {
    path: 'lib/types/index.d.ts',
    extract: (t) => firstQuoted(t, /export\s+declare\s+const\s+name\s*=\s*"([^"]+)"/m),
  },
}

test('publish contract: all name carriers === ' + EXPECTED, () => {
  const actual = {}
  let ok = true
  for (const [label, { path, extract }] of Object.entries(SOURCES)) {
    let value
    try {
      value = extract(read(path))
    } catch (err) {
      value = '<读取失败: ' + err.message + '>'
    }
    actual[label] = value
    if (value !== EXPECTED) ok = false
  }

  if (!ok) {
    const dump = Object.entries(actual)
      .map(([k, v]) => '  ' + k + ' => ' + JSON.stringify(v))
      .join('\n')
    assert.fail(
      '发布契约被破坏：以下位置并非全部 === ' + EXPECTED + '\n' + dump +
      '\n请同步 package.json / cordis.patch.yml / src / tsdown.config.ts / lib 产物中的插件名。',
    )
  }
})

