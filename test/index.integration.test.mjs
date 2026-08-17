/**
 * Host 集成回归：验证 session/event、日志回填、HTTP 统计和工具上下文的边界。
 * 运行前先编译 host bundle：tsc -p tsconfig.json。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { apply } from '../lib/index.js'
import { createRecord, dayKeyOf, serializeRecord, setSlot } from '../src/core.ts'

const realSetTimeout = globalThis.setTimeout

function sleep(ms = 20) {
  return new Promise((resolve) => realSetTimeout(resolve, ms))
}

function writeLog(home, id, events) {
  const path = join(home, 'sessions', 'default', id, 'session.jsonl.zstd')
  mkdirSync(join(home, 'sessions', 'default', id), { recursive: true })
  writeFileSync(path, zstdCompressSync(Buffer.from(events.map((event) => JSON.stringify(event)).join('\n'))))
}

function createHarness({ schemaVersion, records = [], cursor = {}, backfillComplete = true }) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-worktime-board-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'worktime-board'), { recursive: true })
  writeFileSync(join(home, 'worktime-board', 'data.json'), JSON.stringify({
    records: records.map(serializeRecord),
    meta: { schemaVersion, cursor, backfillComplete },
  }))

  const events = new Map()
  const timeouts = []
  const intervals = []
  let cleanup = () => {}
  let route
  let tool
  const originalSetTimeout = globalThis.setTimeout
  const originalSetInterval = globalThis.setInterval
  globalThis.setTimeout = (fn, ms, ...args) => {
    // 插件的首次回填由测试显式触发；其余短延迟（回填让出事件循环）仍走真实计时器。
    if (ms >= 100) {
      const handle = { fn, ms, args }
      timeouts.push(handle)
      return handle
    }
    return originalSetTimeout(fn, ms, ...args)
  }
  globalThis.setInterval = (fn, ms, ...args) => {
    const handle = { fn, ms, args }
    intervals.push(handle)
    return handle
  }

  const ctx = {
    on(name, handler) { events.set(name, handler) },
    webServer: { register(definition) { route = definition.handler; return () => {} } },
    tools: { register(definition) { tool = definition; return () => {} } },
    sessionQuery: { async listSessions() { return [] } },
    workspaceRegistry: { archivedSessionIds: [] },
    effect(fn) { cleanup = fn() },
    logger: {},
  }
  apply(ctx, { retentionDays: 400, flushSeconds: 60, backfillDelayMs: 500, backfillFileGapMs: 0 })

  const state = () => {
    let body = ''
    route({ url: '/plugins/dsh-worktime/state?range=week' }, {
      setHeader() {},
      end(value) { body = String(value) },
    })
    return JSON.parse(body)
  }
  return {
    home,
    events,
    timeouts,
    intervals,
    state,
    get tool() { return tool },
    dispose() {
      cleanup()
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      return JSON.parse(readFileSync(join(home, 'worktime-board', 'data.json'), 'utf8'))
    },
    remove() { rmSync(home, { recursive: true, force: true }) },
  }
}

test('实时事件在增量回填后只计一次', async () => {
  const now = Date.now()
  const id = 'session-dedup'
  const first = { seq: 1, time: now - 3000, type: 'user/message', data: { source: { kind: 'user' } } }
  const second = { seq: 2, time: now - 2000, type: 'user/message', data: { source: { kind: 'user' } } }
  const live = { seq: 3, time: now - 1000, type: 'user/message', data: { source: { kind: 'user' } } }
  const h = createHarness({ schemaVersion: 12, cursor: { [id]: first.time - 1 } })
  try {
    writeLog(h.home, id, [first, second])
    h.timeouts.find((timer) => timer.ms === 500).fn()
    await sleep(60)
    assert.equal(existsSync(join(h.home, 'worktime-board', 'data.json.v12.bak')), true)
    writeLog(h.home, id, [first, second, live])
    h.events.get('session/event')({ id }, live)
    h.intervals.find((timer) => timer.ms === 5 * 60 * 1000).fn()
    await sleep(80)
    const persisted = h.dispose()
    const record = persisted.records.find((item) => item.threadId === id)
    assert.equal(record.userInputs, 3)
    assert.equal(persisted.meta.schemaVersion, 13)
  } finally {
    h.remove()
  }
})

test('周统计使用固定近 7 个自然日，而非最近 7 个活跃日', () => {
  const today = new Date()
  const old = new Date(today)
  old.setDate(old.getDate() - 31)
  const current = createRecord(dayKeyOf(today), 'session-current')
  const stale = createRecord(dayKeyOf(old), 'session-stale')
  setSlot(current, 120)
  setSlot(stale, 120)
  const h = createHarness({ schemaVersion: 13, records: [current, stale] })
  try {
    const state = h.state()
    assert.equal(state.overview.activeDays, 1)
    assert.equal(state.overview.activeMinutes, 5)
    assert.equal(state.heat.days.length, 7)
    assert.equal(state.heat.days.some((day) => day.day === stale.day && day.activeMinutes > 0), false)
  } finally {
    h.dispose()
    h.remove()
  }
})

test('worktime_summary 默认使用调用 agent 的线程，且周统计跨自然日聚合', async () => {
  const today = dayKeyOf(new Date())
  const caller = createRecord(today, 'session-caller')
  const other = createRecord(today, 'session-other')
  setSlot(caller, 120)
  setSlot(other, 120)
  setSlot(other, 121)
  const h = createHarness({ schemaVersion: 13, records: [caller, other] })
  try {
    const result = await h.tool.execute({ range: 'week' }, { agent: { id: 'session-caller' } })
    assert.match(result.text, /线程 session-caller/)
    assert.match(result.text, /出勤 0\.1 小时/)
  } finally {
    h.dispose()
    h.remove()
  }
})
