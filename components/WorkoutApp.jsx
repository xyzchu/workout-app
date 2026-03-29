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

export default function WorkoutApp({ session }) {
  const [days, setDays] = useState(mkDays)
  const [sel, setSel] = useState(0)
  const [exMap, setExMap] = useState({})
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
  const [tmr, setTmr] = useState({
    on: false, vis: false, phase: 'WORK', q: [], qi: 0,
    ps: 0, dur: 0, rem: 0,
  })

  const mkSet = () => ({ weight: '', reps: '', work: settings.defaultWork, rest: settings.defaultRest })
  const mkEx = () => ({ id: uid(), name: 'New Exercise', sets: [mkSet()], note: '' })

  const tR = useRef(tmr)
  const iR = useRef(null)
  const ltR = useRef(-1)
  const loadedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { tR.current = tmr }, [tmr])
  useEffect(() => () => { if (iR.current) clearInterval(iR.current) }, [])

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
  }
  const resetDay = () => { if (!did) return; setExMap(m => ({ ...m, [did]: [] })); setDays(d => d.map((x, i) => i === safeIdx ? { ...x, completed: false } : x)) }
  const saveRename = () => {
    if (editDay && editName.trim()) setDays((d) => d.map((x) => (x.id === editDay ? { ...x, name: editName.trim() } : x)))
    setEditDay(null)
  }

  const addEx = () => setExs((a) => [...a, mkEx()])
  const delEx = (idx) => setExs((a) => a.filter((_, i) => i !== idx))
  const moveEx = (i, d) => setExs((a) => { const j = i + d; if (j < 0 || j >= a.length) return a; const b = [...a]; [b[i], b[j]] = [b[j], b[i]]; return b })
  const updEx = (idx, field, value) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, [field]: value } : e)))
  const addSet = (idx) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: [...e.sets, mkSet()] } : e)))
  const delSet = (idx, si) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)))
  const updSet = (idx, si, f, v) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, [f]: v } : s)) } : e)))

  const exportData = () => {
    const d = { days, exercises: exMap, settings }
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `workout-export-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }
  const importData = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result)
        if (d.days) setDays(d.days)
        if (d.exercises) setExMap(d.exercises)
        if (d.settings) setSettings(d.settings)
        setSel(0)
      } catch { alert('Invalid file') }
    }
    reader.readAsText(file); e.target.value = ''
  }

  const searchResults = searchQ.trim()
    ? days.flatMap((d, di) => (exMap[d.id] || []).filter((e) => e.name.toLowerCase().includes(searchQ.toLowerCase())).map((e) => ({ exName: e.name, dayName: d.name, dayIdx: di })))
    : []

  // Timer
  const buildQ = () => {
    const ex = exMap[did] || []; const q = []; let i = 0
    while (i < ex.length) {
      if (isSS(ex[i].name)) {
        const g = []; while (i < ex.length && isSS(ex[i].name)) { g.push(ex[i]); i++ }
        const mx = Math.max(...g.map((e) => e.sets.length))
        for (let s = 0; s < mx; s++) for (const e of g) if (s < e.sets.length)
          q.push({ nm: e.name, sn: s + 1, ts: e.sets.length, w: Number(e.sets[s].work) || 30, r: Number(e.sets[s].rest) || 60 })
      } else {
        const e = ex[i]
        e.sets.forEach((s, si) => q.push({ nm: e.name, sn: si + 1, ts: e.sets.length, w: Number(s.work) || 30, r: Number(s.rest) || 60 }))
        i++
      }
    }
    return q
  }

  const tick = () => {
    const t = tR.current; if (!t.on) return
    const el = (Date.now() - t.ps) / 1000, rem = t.dur - el, rs = Math.ceil(rem)
    if (rs <= 3 && rs > 0 && rs !== ltR.current) { ltR.current = rs; beep(800, 0.08) }
    if (rem <= 0) {
      if (t.phase === 'WORK') {
        beep(1200, 0.3); const rd = t.q[t.qi].r
        const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }
        setTmr(n); tR.current = n; ltR.current = -1
      } else {
        beep(600, 0.5, 'square'); const ni = t.qi + 1
        if (ni >= t.q.length) stopT()
        else { const wd = t.q[ni].w; const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n; ltR.current = -1 }
      }
    } else setTmr((p) => ({ ...p, rem: Math.max(0, rem) }))
  }

  const startT = () => {
    const q = buildQ(); if (!q.length) return
    if (iR.current) clearInterval(iR.current)
    const n = { on: true, vis: true, phase: 'WORK', q, qi: 0, ps: Date.now(), dur: q[0].w, rem: q[0].w }
    setTmr(n); tR.current = n; ltR.current = -1; iR.current = setInterval(tick, 100)
  }
  const pauseT = () => setTmr((p) => {
    let n; if (p.on) { const rem = p.dur - (Date.now() - p.ps) / 1000; n = { ...p, on: false, rem: Math.max(0, rem) } }
    else { n = { ...p, on: true, ps: Date.now() - (p.dur - p.rem) * 1000 }; if (!iR.current) iR.current = setInterval(tick, 100) }
    tR.current = n; return n
  })
  const skipT = () => {
    const t = tR.current
    if (t.phase === 'WORK') { const rd = t.q[t.qi].r; const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }; setTmr(n); tR.current = n }
    else { const ni = t.qi + 1; if (ni >= t.q.length) stopT(); else { const wd = t.q[ni].w; const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n } }
    ltR.current = -1
  }
  const prevT = () => {
    const t = tR.current
    if (t.phase === 'REST') { const wd = t.q[t.qi].w; const n = { ...t, phase: 'WORK', ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n }
    else if (t.qi > 0) { const pi = t.qi - 1; const wd = t.q[pi].w; const n = { ...t, phase: 'WORK', qi: pi, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n }
    else { const wd = t.q[0].w; const n = { ...t, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n }
    ltR.current = -1
  }
  const nextT = () => {
    const t = tR.current; const ni = t.qi + 1
    if (ni >= t.q.length) stopT()
    else { const wd = t.q[ni].w; const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }; setTmr(n); tR.current = n; ltR.current = -1 }
  }
  const stopT = () => {
    if (iR.current) { clearInterval(iR.current); iR.current = null }
    const n = { on: false, vis: false, phase: 'WORK', q: [], qi: 0, ps: 0, dur: 0, rem: 0 }
    setTmr(n); tR.current = n
  }

  const curQ = tmr.q[tmr.qi]
  const pct = tmr.dur > 0 ? ((tmr.dur - tmr.rem) / tmr.dur) * 100 : 0

  const mono = '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", "Liberation Mono", monospace'

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAF5', fontFamily: mono }}>
      <p className="text-[11px] tracking-[0.2em] uppercase opacity-40 animate-pulse">Loading Data...</p>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#FAFAF5', fontFamily: mono, color: '#111' }}>
      <input ref={fileRef} type="file" accept=".json" onChange={importData} className="hidden" />

      {/* ═══════ HEADER ═══════ */}
      <header style={{ borderBottom: '2px solid #111' }}>
        <div className="max-w-2xl mx-auto px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[15px] font-bold tracking-[0.2em] uppercase leading-tight">Workout Tracker</h1>
              <p className="text-[11px] font-bold tracking-[0.15em] uppercase mt-0.5 opacity-40">Studio V.20</p>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              {saving && <span className="text-[9px] tracking-[0.1em] uppercase opacity-30 animate-pulse">Saving...</span>}
              {saved && !saving && <span className="text-[9px] tracking-[0.1em] uppercase opacity-40">✓ Saved</span>}
            </div>
          </div>
          <p className="text-[9px] tracking-[0.12em] uppercase mt-2 opacity-30">
            Editorial Training System / All Data Persists via Cloud
          </p>
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button onClick={exportData} className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border border-[#bbb] hover:border-[#111] hover:bg-[#111] hover:text-white transition-all">Export Data</button>
            <button onClick={() => fileRef.current?.click()} className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border border-[#bbb] hover:border-[#111] hover:bg-[#111] hover:text-white transition-all">Import Data</button>
            <button onClick={() => setShowSearch(!showSearch)} className={`text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border transition-all ${showSearch ? 'border-[#111] bg-[#111] text-white' : 'border-[#bbb] hover:border-[#111]'}`}>Search</button>
            <div className="flex-1" />
            <button onClick={() => supabase.auth.signOut()} className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border border-[#bbb] hover:border-[#111] hover:bg-[#111] hover:text-white transition-all">Sign Out</button>
          </div>
        </div>
      </header>

      {/* ═══════ SEARCH ═══════ */}
      {showSearch && (
        <div style={{ borderBottom: '1px solid #ddd' }}>
          <div className="max-w-2xl mx-auto px-5 py-4">
            <label className="text-[9px] tracking-[0.15em] uppercase opacity-40 block mb-2">Search Exercises</label>
            <input autoFocus className="w-full bg-transparent text-[13px] outline-none border-b-2 border-[#111] pb-2 tracking-wide"
              placeholder="Type to search..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
            {searchQ && (
              <div className="mt-2 max-h-48 overflow-y-auto">
                {searchResults.length === 0 && <p className="text-[10px] tracking-[0.1em] uppercase opacity-30 py-3">No results found</p>}
                {searchResults.map((r, i) => (
                  <button key={i} onClick={() => { setSel(r.dayIdx); setShowSearch(false); setSearchQ('') }}
                    className="block w-full text-left py-2.5 border-b border-[#eee] hover:bg-[#f0f0e8] px-2 transition-colors">
                    <span className="text-[12px] font-bold tracking-[0.04em] uppercase">{r.exName}</span>
                    <span className="text-[10px] opacity-30 ml-3">{r.dayName}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => { setShowSearch(false); setSearchQ('') }} className="text-[9px] tracking-[0.15em] uppercase mt-3 opacity-40 hover:opacity-100 transition-opacity">Dismiss</button>
          </div>
        </div>
      )}

      {/* ═══════ HOME AUTOMATION SYNC ═══════ */}
      <div style={{ borderBottom: '1px solid #ddd' }}>
        <div className="max-w-2xl mx-auto px-5">
          <button onClick={() => setShowSync(!showSync)} className="w-full py-3 text-left text-[10px] tracking-[0.15em] uppercase font-bold opacity-40 hover:opacity-100 transition-opacity">
            + Home Automation Sync
          </button>
          {showSync && (
            <div className="pb-4 space-y-3">
              <div>
                <label className="text-[9px] tracking-[0.15em] uppercase opacity-40 block mb-1">URL</label>
                <input className="w-full bg-transparent border border-[#ddd] focus:border-[#111] px-3 py-2 text-[12px] outline-none transition-colors"
                  placeholder="https://your-webhook-url.com" value={syncUrl} onChange={(e) => setSyncUrl(e.target.value)} />
              </div>
              <div>
                <label className="text-[9px] tracking-[0.15em] uppercase opacity-40 block mb-1">Token</label>
                <input className="w-full bg-transparent border border-[#ddd] focus:border-[#111] px-3 py-2 text-[12px] outline-none transition-colors"
                  placeholder="Bearer token..." type="password" value={syncToken} onChange={(e) => setSyncToken(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 bg-[#111] text-white border border-[#111]">Save Configuration</button>
                <button className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border border-[#bbb] hover:border-[#111] transition-colors">Test Connection</button>
                <button onClick={() => setShowSync(false)} className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 opacity-40 hover:opacity-100 transition-opacity">Dismiss</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════ DAY NAVIGATION ═══════ */}
      <div style={{ borderBottom: '1px solid #ddd' }}>
        <div className="max-w-2xl mx-auto px-5 py-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              <button onClick={() => setSel(s => Math.max(0, s - 1))} disabled={safeIdx === 0}
                className="text-[11px] tracking-[0.1em] uppercase opacity-40 hover:opacity-100 disabled:opacity-10 transition-opacity select-none">←</button>
              {editDay === did ? (
                <input autoFocus className="bg-transparent border-b-2 border-[#111] text-[13px] font-bold tracking-[0.05em] uppercase outline-none w-32"
                  value={editName} onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename()} onBlur={saveRename} />
              ) : (
                <button onClick={() => { setEditDay(did); setEditName(day.name) }}
                  className="text-[13px] font-bold tracking-[0.05em] uppercase hover:underline decoration-1 underline-offset-4">{day?.name}</button>
              )}
              <span className="text-[10px] opacity-25 tabular-nums">/ {days.length}</span>
              <button onClick={() => setSel(s => Math.min(days.length - 1, s + 1))} disabled={safeIdx === days.length - 1}
                className="text-[11px] tracking-[0.1em] uppercase opacity-40 hover:opacity-100 disabled:opacity-10 transition-opacity select-none">→</button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={addDay} className="text-[9px] tracking-[0.12em] uppercase px-2.5 py-1.5 border border-[#bbb] hover:border-[#111] hover:bg-[#111] hover:text-white transition-all">+ Add</button>
              <button onClick={toggleDone}
                className={`text-[9px] tracking-[0.12em] uppercase px-2.5 py-1.5 border transition-all ${day?.completed ? 'bg-[#111] text-white border-[#111]' : 'border-[#bbb] hover:border-[#111]'}`}>
                {day?.completed ? '✓ Done' : 'Mark Done'}
              </button>
              <button onClick={resetDay} className="text-[9px] tracking-[0.12em] uppercase px-2.5 py-1.5 border border-[#bbb] hover:border-[#111] transition-all">Reset Day</button>
            </div>
          </div>

          {/* Day pills */}
          <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1 scrollbar-hide">
            {days.map((d, i) => (
              <button key={d.id} onClick={() => setSel(i)}
                className={`text-[8px] tracking-[0.1em] uppercase px-2 py-1 border flex-shrink-0 transition-all tabular-nums ${
                  i === safeIdx ? 'bg-[#111] text-white border-[#111]'
                  : d.completed ? 'border-[#111] opacity-50 hover:opacity-100'
                  : 'border-[#ddd] opacity-30 hover:opacity-100 hover:border-[#999]'
                }`}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════ TIMER ═══════ */}
      <div style={{
        borderBottom: tmr.vis ? '2px solid' : '1px solid #ddd',
        borderColor: tmr.vis ? (tmr.phase === 'WORK' ? '#111' : '#4a7ab5') : undefined,
        background: tmr.vis ? (tmr.phase === 'WORK' ? '#111' : '#1a3050') : 'transparent',
        color: tmr.vis ? '#fff' : '#111',
        transition: 'background 0.4s ease, color 0.4s ease',
      }}>
        <div className="max-w-2xl mx-auto px-5 py-4">
          {/* Timer display row */}
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[10px] tracking-[0.15em] uppercase opacity-50">⏱</span>
            <span className="text-[40px] font-bold tabular-nums tracking-tight leading-none select-none">
              {tmr.vis ? fmt(tmr.rem) : '00:00'}
            </span>

            <div className="h-8 w-[1px] mx-1" style={{ background: tmr.vis ? 'rgba(255,255,255,0.15)' : '#ddd' }} />

            {/* Phase indicators */}
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 border transition-all ${
                tmr.vis && tmr.phase === 'WORK' ? 'bg-white text-black border-white font-bold' : tmr.vis ? 'border-white/20 opacity-30' : 'border-[#ddd] opacity-30'
              }`}>Work</span>
              <span className={`text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 border transition-all ${
                tmr.vis && tmr.phase === 'REST' ? 'bg-white text-black border-white font-bold' : tmr.vis ? 'border-white/20 opacity-30' : 'border-[#ddd] opacity-30'
              }`}>Rest</span>
              <span className={`text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 border transition-all ${
                tmr.vis ? 'border-white/10 opacity-15' : 'border-[#ddd] opacity-15'
              }`}>Trans</span>
            </div>
          </div>

          {/* Current exercise info + progress */}
          {tmr.vis && curQ && (
            <div className="mt-3">
              <p className="text-[11px] tracking-[0.1em] uppercase opacity-50">
                {curQ.nm} — Set {curQ.sn}/{curQ.ts} — [{tmr.qi + 1}/{tmr.q.length} total]
              </p>
              <div className="mt-2 h-[2px] w-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full transition-all duration-200 ease-linear" style={{ width: `${pct}%`, background: tmr.phase === 'WORK' ? '#fff' : '#8ab4e8' }} />
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-1.5 mt-4 flex-wrap">
            {!tmr.vis ? (
              <>
                <button onClick={startT}
                  className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-[#111] hover:bg-[#111] hover:text-white transition-all font-bold">
                  ▶ Play / Start
                </button>
                <div className="h-5 w-[1px] mx-1 bg-[#ddd]" />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] tracking-[0.12em] uppercase opacity-40">Work:</span>
                    <input type="number" className="w-12 bg-transparent border-b border-[#ccc] focus:border-[#111] text-[12px] text-center outline-none py-0.5 transition-colors tabular-nums"
                      value={settings.defaultWork} onChange={(e) => setSettings(s => ({ ...s, defaultWork: +e.target.value || 0 }))} />
                    <span className="text-[9px] opacity-25">s</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] tracking-[0.12em] uppercase opacity-40">Rest:</span>
                    <input type="number" className="w-12 bg-transparent border-b border-[#ccc] focus:border-[#111] text-[12px] text-center outline-none py-0.5 transition-colors tabular-nums"
                      value={settings.defaultRest} onChange={(e) => setSettings(s => ({ ...s, defaultRest: +e.target.value || 0 }))} />
                    <span className="text-[9px] opacity-25">s</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <button onClick={prevT} className="text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-white/30 hover:bg-white/10 active:bg-white/20 transition-colors">Prev</button>
                <button onClick={pauseT}
                  className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-white hover:bg-white hover:text-black active:opacity-80 transition-all font-bold">
                  {tmr.on ? '❚❚ Pause' : '▶ Play'}
                </button>
                <button onClick={nextT} className="text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-white/30 hover:bg-white/10 active:bg-white/20 transition-colors">Next</button>
                <div className="h-5 w-[1px] mx-0.5" style={{ background: 'rgba(255,255,255,0.15)' }} />
                <button onClick={skipT} className="text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-white/30 hover:bg-white/10 active:bg-white/20 transition-colors">Skip Phase</button>
                <button onClick={stopT} className="text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-white/30 hover:bg-white/10 active:bg-white/20 transition-colors">Stop</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ═══════ EXERCISES ═══════ */}
      <div className="max-w-2xl mx-auto px-5 py-5 space-y-4">
        {exs.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-[11px] tracking-[0.15em] uppercase opacity-25">No exercises in this collection</p>
            <p className="text-[9px] tracking-[0.1em] uppercase opacity-15 mt-2">Click "+ Add to Collection" below to begin</p>
          </div>
        )}

        {exs.map((ex, idx) => (
          <div key={ex.id} style={{ border: '1px solid #ddd' }}>
            {/* Exercise header */}
            <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid #eee' }}>
              <span className="text-[10px] font-bold tracking-[0.1em] opacity-20 w-5 flex-shrink-0 tabular-nums">{pad2(idx + 1)}</span>
              <span className="text-[10px] opacity-15 select-none">—</span>
              <input
                className="flex-1 text-[13px] font-bold tracking-[0.04em] uppercase bg-transparent outline-none border-b border-transparent focus:border-[#111] transition-colors"
                style={{ fontFamily: mono }}
                value={ex.name}
                onChange={(e) => updEx(idx, 'name', e.target.value)}
                placeholder="Exercise Name"
              />
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={() => moveEx(idx, -1)} disabled={idx === 0}
                  className="text-[11px] px-1.5 py-1 opacity-20 hover:opacity-100 disabled:opacity-5 transition-opacity select-none">↑</button>
                <button onClick={() => moveEx(idx, 1)} disabled={idx === exs.length - 1}
                  className="text-[11px] px-1.5 py-1 opacity-20 hover:opacity-100 disabled:opacity-5 transition-opacity select-none">↓</button>
                <button onClick={() => delEx(idx)}
                  className="text-[12px] px-1.5 py-1 opacity-20 hover:opacity-100 hover:text-red-600 transition-all ml-1 select-none">×</button>
              </div>
            </div>

            {/* Set table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" style={{ fontFamily: mono }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <th className="px-4 py-2.5 text-left tracking-[0.15em] uppercase opacity-25 font-bold w-12">Set</th>
                    <th className="px-2 py-2.5 text-left tracking-[0.15em] uppercase opacity-25 font-bold">Weight</th>
                    <th className="px-2 py-2.5 text-left tracking-[0.15em] uppercase opacity-25 font-bold">Reps</th>
                    <th className="px-2 py-2.5 text-left tracking-[0.15em] uppercase opacity-25 font-bold w-16">Work</th>
                    <th className="px-2 py-2.5 text-left tracking-[0.15em] uppercase opacity-25 font-bold w-16">Rest</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {ex.sets.map((set, si) => (
                    <tr key={si} className="group" style={{ borderBottom: '1px solid #f5f5f0' }}>
                      <td className="px-4 py-2 font-bold opacity-15 tabular-nums">{pad2(si + 1)}</td>
                      <td className="px-2 py-1">
                        <input className="w-full bg-transparent outline-none text-[13px] font-bold py-1 border-b border-transparent focus:border-[#111] transition-colors tabular-nums"
                          style={{ fontFamily: mono }}
                          value={set.weight} onChange={(e) => updSet(idx, si, 'weight', e.target.value)} placeholder="—" inputMode="decimal" />
                      </td>
                      <td className="px-2 py-1">
                        <input className="w-full bg-transparent outline-none text-[13px] font-bold py-1 border-b border-transparent focus:border-[#111] transition-colors tabular-nums"
                          style={{ fontFamily: mono }}
                          value={set.reps} onChange={(e) => updSet(idx, si, 'reps', e.target.value)} placeholder="—" inputMode="numeric" />
                      </td>
                      <td className="px-2 py-1">
                        <input className="w-full bg-transparent outline-none text-[12px] py-1 opacity-35 focus:opacity-100 border-b border-transparent focus:border-[#111] transition-all tabular-nums"
                          style={{ fontFamily: mono }}
                          type="number" value={set.work} onChange={(e) => updSet(idx, si, 'work', +e.target.value)} />
                      </td>
                      <td className="px-2 py-1">
                        <input className="w-full bg-transparent outline-none text-[12px] py-1 opacity-35 focus:opacity-100 border-b border-transparent focus:border-[#111] transition-all tabular-nums"
                          style={{ fontFamily: mono }}
                          type="number" value={set.rest} onChange={(e) => updSet(idx, si, 'rest', +e.target.value)} />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button onClick={() => delSet(idx, si)}
                          className="opacity-0 group-hover:opacity-25 hover:!opacity-100 hover:text-red-600 transition-all text-[12px] select-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add set */}
            <div className="px-4 py-2.5" style={{ borderTop: '1px solid #eee' }}>
              <button onClick={() => addSet(idx)}
                className="text-[9px] tracking-[0.15em] uppercase opacity-25 hover:opacity-100 transition-opacity font-bold">
                + Add Set
              </button>
            </div>

            {/* Note */}
            <div className="px-4 py-2.5" style={{ borderTop: '1px solid #f5f5f0' }}>
              <textarea
                className="w-full bg-transparent outline-none text-[11px] opacity-35 focus:opacity-100 resize-none transition-opacity leading-relaxed"
                style={{ fontFamily: mono }}
                rows={1}
                placeholder="Notes..."
                value={ex.note}
                onChange={(e) => updEx(idx, 'note', e.target.value)}
              />
            </div>
          </div>
        ))}

        {/* Add Exercise */}
        <button onClick={addEx}
          className="w-full py-4 text-[10px] tracking-[0.2em] uppercase font-bold border border-dashed border-[#bbb] hover:border-[#111] hover:bg-[#111] hover:text-white transition-all">
          + Add to Collection
        </button>
      </div>

      {/* ═══════ FOOTER ═══════ */}
      <footer style={{ borderTop: '1px solid #eee' }}>
        <div className="max-w-2xl mx-auto px-5 py-4">
          <p className="text-[8px] tracking-[0.2em] uppercase opacity-20 text-center">
            Workout Tracker Studio V.20 — {session.user.email}
          </p>
        </div>
      </footer>
    </div>
  )
}