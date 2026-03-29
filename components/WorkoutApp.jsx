'use client'
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const uid = () => Math.random().toString(36).slice(2, 11)
const mkDays = () => Array.from({ length: 10 }, (_, i) => ({ id: uid(), name: `Day ${i + 1}`, completed: false }))
const isSS = (n) => n?.toLowerCase().includes('superset')
const pad2 = (n) => String(n).padStart(2, '0')
const fmt = (s) => `${pad2(Math.floor(Math.max(0, s) / 60))}:${pad2(Math.floor(Math.max(0, s) % 60))}`

let _ac
const ac = () => { if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)(); return _ac }
const beep = (f, d, t = 'sine', v = 0.3) => {
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain()
    o.connect(g); g.connect(c.destination); o.type = t; o.frequency.value = f; g.gain.value = v
    o.start(); o.stop(c.currentTime + d)
  } catch {}
}

const mono = '"SF Mono","Fira Code","Cascadia Code","Consolas","Liberation Mono",monospace'
const B = 'text-[14px]'
const gridCols = '44px 1fr 1fr 1fr 1fr 32px'
const WORK_BG = '#1a4d2e'
const REST_BG = '#3d2066'

export default function WorkoutApp({ session }) {
  const [days, setDays] = useState(mkDays)
  const [sel, setSel] = useState(0)
  const [exMap, setExMap] = useState({})
  const [showTools, setShowTools] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [editDay, setEditDay] = useState(null)
  const [editName, setEditName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [settings, setSettings] = useState({ defaultWork: 60, defaultRest: 120 })
  const [syncUrl, setSyncUrl] = useState('')
  const [syncToken, setSyncToken] = useState('')
  const [clipDay, setClipDay] = useState(null)
  const [clipEx, setClipEx] = useState(null)
  const [tmr, setTmr] = useState({ on: false, vis: false, phase: 'WORK', q: [], qi: 0, ps: 0, dur: 0, rem: 0 })
  const [tmrDayId, setTmrDayId] = useState(null)
  const [confirmDlg, setConfirmDlg] = useState(null)

  const mkSet = () => ({ weight: '', reps: '', work: settings.defaultWork, rest: settings.defaultRest })
  const mkEx = () => ({ id: uid(), name: 'New Exercise', sets: [mkSet()], note: '' })

  const tR = useRef(tmr)
  const iR = useRef(null)
  const ltR = useRef(-1)
  const loadedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const fileRef = useRef(null)
  const dayScrollRef = useRef(null)
  const prevEiRef = useRef(-1)

  const scrollDays = (dir) => {
    dayScrollRef.current?.scrollBy({ left: dir * 150, behavior: 'smooth' })
  }

  useEffect(() => { tR.current = tmr }, [tmr])
  useEffect(() => () => { if (iR.current) clearInterval(iR.current) }, [])

  /* Auto-scroll to current exercise card when exercise changes */
  useEffect(() => {
    if (tmr.vis && tmr.q[tmr.qi]) {
      const newEi = tmr.q[tmr.qi].ei
      if (newEi !== prevEiRef.current) {
        prevEiRef.current = newEi
        setTimeout(() => {
          const el = document.getElementById(`ex-card-${newEi}`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 150)
      }
    } else {
      prevEiRef.current = -1
    }
  }, [tmr.qi, tmr.vis])

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('workout_data').select('*').eq('user_id', session.user.id).maybeSingle()
      if (data) {
        if (data.days?.length > 0) setDays(data.days)
        if (data.exercises) setExMap(data.exercises)
        if (typeof data.selected_day === 'number') setSel(data.selected_day)
        if (data.settings) setSettings(data.settings)
      }
      loadedRef.current = true
      setIsLoading(false)
    }
    load()
  }, [session.user.id])

  useEffect(() => {
    if (!loadedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      const { error } = await supabase.from('workout_data').upsert(
        { user_id: session.user.id, days, exercises: exMap, selected_day: sel, settings, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      setSaving(false)
      if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    }, 1500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [days, exMap, sel, settings, session.user.id])

  const ask = (msg, fn) => setConfirmDlg({ msg, fn })
  const doConfirm = () => { confirmDlg?.fn(); setConfirmDlg(null) }

  const safeIdx = Math.min(sel, days.length - 1)
  const day = days[safeIdx]
  const did = day?.id
  const exs = exMap[did] || []
  const setExs = (fn) => setExMap((m) => ({ ...m, [did]: typeof fn === 'function' ? fn(m[did] || []) : fn }))

  const addDay = () => { setDays((d) => [...d, { id: uid(), name: `Day ${d.length + 1}`, completed: false }]); setSel(days.length) }
  const toggleDone = () => setDays((d) => d.map((x, i) => (i === safeIdx ? { ...x, completed: !x.completed } : x)))
  const delDay = () => {
    if (days.length <= 1) return
    const id = days[safeIdx].id
    setDays((d) => d.filter((_, i) => i !== safeIdx))
    setExMap((m) => { const n = { ...m }; delete n[id]; return n })
    if (sel >= safeIdx && sel > 0) setSel((s) => s - 1)
    if (tmrDayId === id) stopTInner()
  }
  const delDayConfirm = () => { if (days.length <= 1) return; ask('Delete this day and all its exercises?', delDay) }
  const resetDay = () => { if (!did) return; setExMap((m) => ({ ...m, [did]: [] })); setDays((d) => d.map((x, i) => (i === safeIdx ? { ...x, completed: false } : x))) }
  const resetDayConfirm = () => ask('Reset all exercises for this day?', resetDay)
  const copyDay = () => setClipDay(JSON.parse(JSON.stringify(exs)))
  const pasteDay = () => { if (!clipDay || !did) return; setExs((a) => [...a, ...clipDay.map((e) => ({ ...e, id: uid() }))]) }
  const saveRename = () => {
    if (editDay !== null && editName.trim()) setDays((d) => d.map((x) => (x.id === editDay ? { ...x, name: editName.trim() } : x)))
    setEditDay(null)
  }

  const addEx = () => setExs((a) => [...a, mkEx()])
  const delEx = (idx) => setExs((a) => a.filter((_, i) => i !== idx))
  const delExConfirm = (idx) => ask('Delete this exercise?', () => delEx(idx))
  const moveEx = (i, d) => setExs((a) => { const j = i + d; if (j < 0 || j >= a.length) return a; const b = [...a]; [b[i], b[j]] = [b[j], b[i]]; return b })
  const updEx = (idx, f, v) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, [f]: v } : e)))
  const copyEx = (idx) => setClipEx(JSON.parse(JSON.stringify(exs[idx])))
  const pasteExAt = (idx) => { if (!clipEx) return; setExs((a) => { const b = [...a]; b.splice(idx, 0, { ...JSON.parse(JSON.stringify(clipEx)), id: uid() }); return b }) }
  const pasteExEnd = () => { if (!clipEx) return; setExs((a) => [...a, { ...JSON.parse(JSON.stringify(clipEx)), id: uid() }]) }

  const addSet = (idx) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: [...e.sets, mkSet()] } : e)))
  const delSet = (idx, si) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)))
  const delSetConfirm = (idx, si) => ask('Delete this set?', () => delSet(idx, si))
  const updSet = (idx, si, f, v) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, [f]: v } : s)) } : e)))

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ days, exercises: exMap, settings }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `workout-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }
  const importData = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = (ev) => { try { const d = JSON.parse(ev.target.result); if (d.days) setDays(d.days); if (d.exercises) setExMap(d.exercises); if (d.settings) setSettings(d.settings); setSel(0) } catch {} }
    r.readAsText(file); e.target.value = ''
  }

  const searchResults = searchQ.trim()
    ? days.flatMap((d, di) => (exMap[d.id] || []).filter((e) => e.name.toLowerCase().includes(searchQ.toLowerCase())).map((e) => ({ exName: e.name, dayName: d.name, dayIdx: di })))
    : []

  const buildQ = () => {
    const ex = exMap[did] || []; const q = []; let i = 0
    while (i < ex.length) {
      if (isSS(ex[i].name)) {
        const g = []; const gIdx = []
        while (i < ex.length && isSS(ex[i].name)) { g.push(ex[i]); gIdx.push(i); i++ }
        const mx = Math.max(...g.map((e) => e.sets.length))
        for (let s = 0; s < mx; s++) for (let gi = 0; gi < g.length; gi++) {
          const e = g[gi]
          if (s < e.sets.length) q.push({ nm: e.name, ei: gIdx[gi], sn: s + 1, ts: e.sets.length, w: Number(e.sets[s].work) || 30, r: Number(e.sets[s].rest) || 60 })
        }
      } else { const e = ex[i]; e.sets.forEach((s, si) => q.push({ nm: e.name, ei: i, sn: si + 1, ts: e.sets.length, w: Number(s.work) || 30, r: Number(s.rest) || 60 })); i++ }
    }
    return q
  }
  const tick = () => {
    const t = tR.current; if (!t.on) return
    const el = (Date.now() - t.ps) / 1000, rem = t.dur - el, rs = Math.ceil(rem)
    if (rs <= 3 && rs > 0 && rs !== ltR.current) { ltR.current = rs; beep(800, 0.08) }
    if (rem <= 0) {
      if (t.phase === 'WORK') { beep(1200, 0.3); const rd = t.q[t.qi].r; const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }; setTmr(n); tR.current = n; ltR.current = -1 }
      else { beep(600, 0.5, 'square'); const ni = t.qi + 1; if (ni >= t.q.length) stopTInner(); else { const wd = t.q[ni].w; const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n; ltR.current = -1 } }
    } else setTmr((p) => ({ ...p, rem: Math.max(0, rem) }))
  }
  const startT = () => { const q = buildQ(); if (!q.length) return; if (iR.current) clearInterval(iR.current); const n = { on: true, vis: true, phase: 'WORK', q, qi: 0, ps: Date.now(), dur: q[0].w, rem: q[0].w }; setTmr(n); tR.current = n; ltR.current = -1; prevEiRef.current = -1; iR.current = setInterval(tick, 100); setTmrDayId(did) }
  const pauseT = () => setTmr((p) => { let n; if (p.on) { n = { ...p, on: false, rem: Math.max(0, p.dur - (Date.now() - p.ps) / 1000) } } else { n = { ...p, on: true, ps: Date.now() - (p.dur - p.rem) * 1000 }; if (!iR.current) iR.current = setInterval(tick, 100) } tR.current = n; return n })
  const skipT = () => { const t = tR.current; if (t.phase === 'WORK') { const rd = t.q[t.qi].r; const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }; setTmr(n); tR.current = n } else { const ni = t.qi + 1; if (ni >= t.q.length) stopTInner(); else { const wd = t.q[ni].w; const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n } } ltR.current = -1 }
  const prevT = () => { const t = tR.current; if (t.phase === 'REST') { const wd = t.q[t.qi].w; const n = { ...t, phase: 'WORK', ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n } else if (t.qi > 0) { const pi = t.qi - 1; const wd = t.q[pi].w; const n = { ...t, phase: 'WORK', qi: pi, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n } else { const wd = t.q[0].w; const n = { ...t, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n } ltR.current = -1 }
  const nextT = () => { const t = tR.current; const ni = t.qi + 1; if (ni >= t.q.length) stopTInner(); else { const wd = t.q[ni].w; const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n; ltR.current = -1 } }
  const stopTInner = () => { if (iR.current) { clearInterval(iR.current); iR.current = null } const n = { on: false, vis: false, phase: 'WORK', q: [], qi: 0, ps: 0, dur: 0, rem: 0 }; setTmr(n); tR.current = n; setTmrDayId(null); prevEiRef.current = -1 }
  const stopTConfirm = () => ask('Stop the timer?', stopTInner)

  const curQ = tmr.q[tmr.qi]
  const pct = tmr.dur > 0 ? ((tmr.dur - tmr.rem) / tmr.dur) * 100 : 0
  const curExIdx = tmr.vis ? (curQ?.ei ?? -1) : -1
  const timerOnThisDay = tmr.vis && tmrDayId === did
  const tmrDayName = days.find((d) => d.id === tmrDayId)?.name || ''
  const phaseBg = tmr.phase === 'WORK' ? WORK_BG : REST_BG

  /* ── inline timer widget ── */
  const renderTimerWidget = () => (
    <div style={{
      background: phaseBg,
      color: '#f5f5ee',
      transition: 'background 0.4s ease',
    }}>
      <div className="px-5 py-5">
        <div className="flex items-center gap-5 flex-wrap">
          <span className="text-[52px] font-bold tabular-nums tracking-tight leading-none select-none"
            style={{ fontFamily: mono }}>
            {fmt(tmr.rem)}
          </span>
          <div className="flex items-center gap-2">
            <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full transition-all ${
              tmr.phase === 'WORK' ? 'bg-[#f5f5ee] text-[#222] font-bold' : 'border-2 border-[#f5f5ee]/20 opacity-30'
            }`}>Work</span>
            <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full transition-all ${
              tmr.phase === 'REST' ? 'bg-[#f5f5ee] text-[#222] font-bold' : 'border-2 border-[#f5f5ee]/20 opacity-30'
            }`}>Rest</span>
          </div>
        </div>
        <div className="mt-3 h-1 w-full rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }}>
          <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: '#f5f5ee' }} />
        </div>
        <div className="flex items-center gap-2 mt-5 flex-wrap">
          {[
            { label: 'Prev', fn: prevT },
            { label: tmr.on ? '❚❚ Pause' : '▶ Play', fn: pauseT, primary: true },
            { label: 'Next', fn: nextT },
            { label: 'Skip', fn: skipT },
            { label: 'Stop', fn: stopTConfirm },
          ].map((b) => (
            <button key={b.label} onClick={b.fn}
              className={`${B} tracking-[0.1em] uppercase px-4 py-3 rounded-xl transition-all ${
                b.primary
                  ? 'border-2 border-[#f5f5ee] hover:bg-[#f5f5ee] hover:text-[#222] font-bold'
                  : 'border-2 border-[#f5f5ee]/25 hover:border-[#f5f5ee]/60 active:bg-[#f5f5ee]/10'
              }`}>{b.label}</button>
          ))}
        </div>
      </div>
    </div>
  )

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAF5', fontFamily: mono }}>
      <p className={`${B} tracking-[0.15em] uppercase opacity-40 animate-pulse`}>Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#FAFAF5', fontFamily: mono, color: '#1a1a1a' }}>
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <input ref={fileRef} type="file" accept=".json" onChange={importData} className="hidden" />

      {/* CONFIRM DIALOG */}
      {confirmDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="mx-4 max-w-sm w-full p-6 rounded-2xl" style={{ background: '#FAFAF5', fontFamily: mono }}>
            <p className={`${B} tracking-[0.08em] uppercase font-bold mb-2`}>Confirm</p>
            <p className={`${B} tracking-[0.04em] mb-6 opacity-60 leading-relaxed`}>{confirmDlg.msg}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDlg(null)}
                className={`flex-1 ${B} tracking-[0.1em] uppercase px-5 py-3 rounded-xl border-2 border-[#ccc] hover:border-[#222] transition-colors`}>Cancel</button>
              <button onClick={doConfirm}
                className={`flex-1 ${B} tracking-[0.1em] uppercase px-5 py-3 rounded-xl bg-[#222] text-[#f5f5ee] font-bold hover:bg-[#444] transition-colors`}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header>
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-end justify-between gap-4">
          <h1 className="text-[52px] font-bold tracking-tight uppercase leading-none">Workout Tracker</h1>
          <span className={`${B} tracking-[0.1em] uppercase opacity-30 pb-1 flex-shrink-0`}>
            {saving ? 'Saving...' : saved ? '✓ Saved' : ''}
          </span>
        </div>
      </header>

      {/* TOOLS TOGGLE */}
      <div>
        <div className="max-w-2xl mx-auto px-4">
          <button onClick={() => setShowTools(!showTools)}
            className={`w-full py-4 text-left ${B} tracking-[0.12em] uppercase font-bold opacity-40 hover:opacity-100 transition-opacity`}>
            {showTools ? '− Hide Tools' : '+ Show Tools'}
          </button>

          {showTools && (
            <div className="pb-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Export', fn: exportData },
                  { label: 'Import', fn: () => fileRef.current?.click() },
                  { label: 'Search', fn: () => { setShowSearch(!showSearch); if (showSearch) setSearchQ('') } },
                  { label: 'Copy Day', fn: copyDay },
                  { label: clipDay ? 'Paste Day ✓' : 'Paste Day', fn: pasteDay, off: !clipDay },
                  { label: 'Sign Out', fn: () => supabase.auth.signOut() },
                ].map((b) => (
                  <button key={b.label} onClick={b.fn} disabled={b.off}
                    className={`${B} tracking-[0.1em] uppercase px-4 py-3 rounded-xl border transition-colors ${
                      b.off ? 'border-[#eee] opacity-20 cursor-default' : 'border-[#bbb] hover:border-[#222] active:bg-[#222] active:text-white'
                    }`}>{b.label}</button>
                ))}
              </div>

              {showSearch && (
                <div>
                  <input autoFocus className={`w-full bg-transparent ${B} outline-none border-b-2 border-[#222] pb-2 tracking-wide uppercase`}
                    placeholder="Search exercises..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
                  {searchQ && (
                    <div className="mt-2 max-h-52 overflow-y-auto">
                      {searchResults.length === 0 && <p className={`${B} uppercase opacity-25 py-4`}>No results</p>}
                      {searchResults.map((r, i) => (
                        <button key={i} onClick={() => { setSel(r.dayIdx); setShowSearch(false); setSearchQ('') }}
                          className={`block w-full text-left py-3 border-b border-[#eee] hover:bg-[#f0f0e8] px-2 rounded-lg`}>
                          <span className={`${B} font-bold uppercase`}>{r.exName}</span>
                          <span className={`${B} opacity-30 ml-3`}>{r.dayName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <button onClick={() => setShowSync(!showSync)}
                  className={`${B} tracking-[0.12em] uppercase font-bold opacity-40 hover:opacity-100 transition-opacity`}>
                  {showSync ? '− Home Automation Sync' : '+ Home Automation Sync'}
                </button>
                {showSync && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className={`${B} tracking-[0.12em] uppercase opacity-35 block mb-1`}>URL</label>
                      <input className={`w-full bg-transparent border border-[#ddd] focus:border-[#222] px-4 py-3 rounded-xl ${B} outline-none`}
                        placeholder="https://..." value={syncUrl} onChange={(e) => setSyncUrl(e.target.value)} />
                    </div>
                    <div>
                      <label className={`${B} tracking-[0.12em] uppercase opacity-35 block mb-1`}>Token</label>
                      <input className={`w-full bg-transparent border border-[#ddd] focus:border-[#222] px-4 py-3 rounded-xl ${B} outline-none`}
                        placeholder="Bearer token..." type="password" value={syncToken} onChange={(e) => setSyncToken(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <button className={`${B} tracking-[0.1em] uppercase px-4 py-3 rounded-xl border border-[#222]`}>Save</button>
                      <button className={`${B} tracking-[0.1em] uppercase px-4 py-3 rounded-xl border border-[#bbb] hover:border-[#222]`}>Test</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DAY PILLS */}
      <div>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2 pb-3">
            <button onClick={() => scrollDays(-1)}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-[#f0f0ea] hover:bg-[#e0e0d5] transition-colors">
              <span className="text-[16px] text-[#666] font-bold leading-none">‹</span>
            </button>
            <div ref={dayScrollRef} className="flex items-center gap-2 overflow-x-auto flex-1 no-scrollbar">
              {days.map((d, i) => (
                <button key={d.id} onClick={() => setSel(i)}
                  className={`${B} tracking-[0.06em] uppercase px-4 py-2.5 rounded-full flex-shrink-0 transition-all whitespace-nowrap ${
                    i === safeIdx
                      ? 'bg-[#222] text-[#f5f5ee] font-bold'
                      : d.completed
                      ? 'bg-[#e8e8e0] opacity-50 hover:opacity-80'
                      : 'bg-[#f0f0ea] opacity-60 hover:opacity-100'
                  }`}>
                  {d.completed ? '✓ ' : ''}{d.name}
                </button>
              ))}
            </div>
            <button onClick={() => scrollDays(1)}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-[#f0f0ea] hover:bg-[#e0e0d5] transition-colors">
              <span className="text-[16px] text-[#666] font-bold leading-none">›</span>
            </button>
          </div>

          {editDay !== null && (
            <div className="pb-3">
              <input autoFocus className={`w-full bg-transparent border-b-2 border-[#222] ${B} font-bold uppercase outline-none py-2`}
                value={editName} onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditDay(null) }} onBlur={saveRename} />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={toggleDone}
              className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl transition-colors ${
                day?.completed ? 'bg-[#222] text-[#f5f5ee] font-bold' : 'bg-[#f0f0ea] hover:bg-[#e0e0d5]'
              }`}>{day?.completed ? '✓ Done' : 'Mark Done'}</button>

            {showTools && (
              <>
                {[
                  { label: '+ Add', fn: addDay },
                  { label: 'Rename', fn: () => { setEditDay(did); setEditName(day.name) } },
                  { label: 'Reset', fn: resetDayConfirm },
                  { label: 'Delete', fn: delDayConfirm, off: days.length <= 1 },
                ].map((b) => (
                  <button key={b.label} onClick={b.fn} disabled={b.off}
                    className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl transition-colors ${
                      b.off ? 'bg-[#f5f5f0] opacity-15 cursor-default' : 'bg-[#f0f0ea] hover:bg-[#e0e0d5]'
                    }`}>{b.label}</button>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* TIMER START SECTION */}
      {!tmr.vis && (
        <div>
          <div className="max-w-2xl mx-auto px-4 py-5">
            <div className="flex items-center gap-5 flex-wrap">
              <span className="text-[52px] font-bold tabular-nums tracking-tight leading-none select-none opacity-20"
                style={{ fontFamily: mono }}>00:00</span>
              <div className="flex items-center gap-2">
                <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full border-2 border-[#ddd] opacity-30`}>Work</span>
                <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full border-2 border-[#ddd] opacity-30`}>Rest</span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-5 flex-wrap">
              <button onClick={startT}
                className={`${B} tracking-[0.12em] uppercase px-5 py-3 rounded-xl border-2 border-[#222] hover:bg-[#222] hover:text-[#f5f5ee] transition-all font-bold`}>
                ▶ Start
              </button>
              <div className="flex items-center gap-4 ml-2">
                <label className="flex items-center gap-2">
                  <span className={`${B} uppercase opacity-40`}>W</span>
                  <input type="number" className={`w-16 bg-[#f0f0ea] rounded-xl ${B} text-center outline-none py-2.5 tabular-nums`}
                    value={settings.defaultWork} onChange={(e) => setSettings((s) => ({ ...s, defaultWork: +e.target.value || 0 }))} />
                </label>
                <label className="flex items-center gap-2">
                  <span className={`${B} uppercase opacity-40`}>R</span>
                  <input type="number" className={`w-16 bg-[#f0f0ea] rounded-xl ${B} text-center outline-none py-2.5 tabular-nums`}
                    value={settings.defaultRest} onChange={(e) => setSettings((s) => ({ ...s, defaultRest: +e.target.value || 0 }))} />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TIMER BANNER — different day */}
      {tmr.vis && tmrDayId !== did && (
        <div style={{ background: phaseBg, color: '#f5f5ee', transition: 'background 0.4s ease' }}>
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <span className="text-[32px] font-bold tabular-nums tracking-tight" style={{ fontFamily: mono }}>{fmt(tmr.rem)}</span>
              <div>
                <span className={`${B} tracking-[0.08em] uppercase opacity-50`}>
                  {curQ?.nm} — {tmr.phase} — Set {curQ?.sn}/{curQ?.ts}
                </span>
                <p className={`${B} tracking-[0.06em] uppercase opacity-30 mt-1`}>on {tmrDayName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={pauseT}
                className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl border-2 border-[#f5f5ee] hover:bg-[#f5f5ee] hover:text-[#222] font-bold transition-all`}>
                {tmr.on ? '❚❚ Pause' : '▶ Play'}
              </button>
              <button onClick={stopTConfirm}
                className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl border-2 border-[#f5f5ee]/25 hover:border-[#f5f5ee]/60 transition-all`}>Stop</button>
            </div>
          </div>
        </div>
      )}

      {/* EXERCISES */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {exs.length === 0 && (
          <div className="py-20 text-center">
            <p className={`${B} tracking-[0.12em] uppercase opacity-20`}>No exercises yet</p>
            <p className={`${B} tracking-[0.1em] uppercase opacity-15 mt-2`}>Tap + Add Exercise below</p>
          </div>
        )}

        {exs.map((ex, idx) => {
          const isTimerHere = timerOnThisDay && curExIdx === idx
          return (
            <div key={ex.id} id={`ex-card-${idx}`}>
              <div style={{
                borderRadius: '20px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
                overflow: 'hidden',
              }}>
                <div style={{ background: '#FFFFFF' }}>
                  {/* Exercise header */}
                  <div className="px-5 py-4 flex items-center gap-3">
                    <span className={`${B} font-bold text-[#111] opacity-30 tabular-nums flex-shrink-0`}>{pad2(idx + 1)}</span>
                    <input
                      className={`flex-1 ${B} font-bold tracking-[0.04em] uppercase bg-transparent outline-none text-[#111] border-b-2 border-transparent focus:border-[#222] transition-colors py-1`}
                      value={ex.name} onChange={(e) => updEx(idx, 'name', e.target.value)} placeholder="Exercise Name"
                    />
                    {showTools && (
                      <div className="flex items-center flex-shrink-0">
                        <button onClick={() => copyEx(idx)} title="Copy"
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] opacity-35 hover:opacity-100 transition-opacity`}>⧉</button>
                        {clipEx && (
                          <button onClick={() => pasteExAt(idx)} title="Paste here"
                            className={`${B} w-10 h-10 flex items-center justify-center text-[#111] opacity-35 hover:opacity-100 transition-opacity`}>⊞</button>
                        )}
                        <button onClick={() => moveEx(idx, -1)} disabled={idx === 0}
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] transition-opacity ${idx === 0 ? 'opacity-10' : 'opacity-35 hover:opacity-100'}`}>↑</button>
                        <button onClick={() => moveEx(idx, 1)} disabled={idx === exs.length - 1}
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] transition-opacity ${idx === exs.length - 1 ? 'opacity-10' : 'opacity-35 hover:opacity-100'}`}>↓</button>
                        <button onClick={() => delExConfirm(idx)} title="Delete"
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] opacity-35 hover:opacity-100 hover:text-red-600 transition-all`}>×</button>
                      </div>
                    )}
                  </div>

                  {/* Sets */}
                  <div className="px-3">
                    <div className="py-2"
                      style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center' }}>
                      {['Set', 'Weight', 'Reps', 'Work', 'Rest', ''].map((h, i) => (
                        <span key={i} className="text-center text-[10px] tracking-[0.12em] uppercase text-[#111] opacity-40 font-bold">{h}</span>
                      ))}
                    </div>
                    {ex.sets.map((set, si) => {
                      const isCurrentSet = isTimerHere && curQ && (si + 1) === curQ.sn
                      return (
                        <div key={si} className="py-1.5"
                          style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center' }}>
                          <div className="flex items-center justify-center">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${B} font-bold tabular-nums transition-all ${
                              isCurrentSet ? 'bg-[#1a1a1a] text-white' : 'text-[#111] opacity-25'
                            }`}>
                              {pad2(si + 1)}
                            </span>
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] font-bold text-[#111] outline-none tabular-nums transition-all focus:bg-[#e8e8df]"
                              value={set.weight} onChange={(e) => updSet(idx, si, 'weight', e.target.value)} placeholder="—" inputMode="decimal" />
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] font-bold text-[#111] outline-none tabular-nums transition-all focus:bg-[#e8e8df]"
                              value={set.reps} onChange={(e) => updSet(idx, si, 'reps', e.target.value)} placeholder="—" inputMode="numeric" />
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] text-[#111] outline-none tabular-nums transition-all opacity-35 focus:opacity-100 focus:bg-[#e8e8df]"
                              type="number" value={set.work} onChange={(e) => updSet(idx, si, 'work', +e.target.value)} />
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] text-[#111] outline-none tabular-nums transition-all opacity-35 focus:opacity-100 focus:bg-[#e8e8df]"
                              type="number" value={set.rest} onChange={(e) => updSet(idx, si, 'rest', +e.target.value)} />
                          </div>
                          <div className="flex items-center justify-center">
                            <button onClick={() => delSetConfirm(idx, si)}
                              className={`${B} text-[#111] opacity-25 hover:opacity-100 hover:text-red-600 transition-all w-8 h-8 inline-flex items-center justify-center`}>×</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Add Set */}
                  <div className="px-5 py-3">
                    <button onClick={() => addSet(idx)}
                      className={`${B} tracking-[0.12em] uppercase text-[#111] opacity-30 hover:opacity-100 transition-opacity font-bold py-1`}>+ Add Set</button>
                  </div>

                  {/* Notes */}
                  <div className="px-5 pb-4">
                    <textarea
                      className={`w-full bg-[#F0F0EA] rounded-xl outline-none ${B} text-[#111] opacity-35 focus:opacity-100 resize-none transition-all p-3 leading-relaxed focus:bg-[#e8e8df]`}
                      rows={1} placeholder="Notes..." value={ex.note} onChange={(e) => updEx(idx, 'note', e.target.value)}
                    />
                  </div>
                </div>

                {/* INLINE TIMER */}
                {isTimerHere && renderTimerWidget()}
              </div>
            </div>
          )
        })}

        <div className="space-y-3 pt-2">
          <button onClick={addEx}
            className={`w-full py-5 ${B} tracking-[0.15em] uppercase font-bold border-2 border-dashed rounded-2xl border-[#bbb] hover:border-[#222] active:bg-[#f0f0e5] transition-all`}>
            + Add Exercise
          </button>
          {showTools && clipEx && (
            <button onClick={pasteExEnd}
              className={`w-full py-5 ${B} tracking-[0.15em] uppercase font-bold border-2 border-dashed rounded-2xl border-[#aaa] hover:border-[#222] active:bg-[#f0f0e5] transition-all opacity-50 hover:opacity-100`}>
              ⧉ Paste: {clipEx.name}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}