import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import {
  UploadCloud, FolderPlus, ShieldAlert, RefreshCw, Link2, Film,
  CheckCircle2, XCircle, Pencil, X, Library, ImagePlus,
  CreditCard, Check, Copy, AlertTriangle, Zap, Code2, Crown,
  UserCheck, UserX, FileCheck, FileX, ListPlus, Trash2, Eye,
  GripVertical, Layers, Plus, UploadIcon, IndianRupee,
  Calculator, Wallet, Clock, ChevronDown, TrendingUp, Users, BarChart2,
  Activity, Server, AlertCircle, Database, Heart, MessageCircle, Play,
} from 'lucide-react'
import { uploadToCloudinary, cloudinaryTransform } from '../services/cloudinary'
import { useStore } from '../store/useStore'
import { useUploadNotifier } from '../hooks/useUploadNotifier'
import {
  createAdminCollection, createBunnyCollection, createUploadJob, fetchAdminContentById,
  getAdminSession, importFromCdn, syncCdnDeletions, listBunnyCollections, listBunnyVideos,
  listAdminCollections, listAdminContent, listUploadJobs,
  mapExistingBunnyVideo, createAdminContent, updateAdminContent, togglePublishContent, deleteAdminContent,
  uploadJobFile, getPaymentConfig, updatePaymentConfig,
  listCreatorApplications, approveCreatorApplication, rejectCreatorApplication,
  listAdminSubmissions, approveSubmission, rejectSubmission,
  listAdminShelves, createAdminShelf, updateAdminShelf, deleteAdminShelf, reorderAdminShelves,
  listAdminCreatorEarnings, calculateCreatorEarnings, processCreatorPayout, listAdminCreatorPayouts,
  getAdminRevenue, getAdminMonitor,
  listAdminReels, approveAdminReel, rejectAdminReel, deleteAdminReel,
} from '../services/api'
import styles from './Admin.module.css'
import { isValidDuration } from '../utils/duration'

// ── Monitor dashboard — SVG chart components ─────────────────────────────────

const MON_CYAN = '#22d3ee'

// 7-day DAU bar chart
function MonDAUChart({ data }) {
  if (!data?.length) return null
  const W = 540, H = 100, PT = 20, PB = 18, PL = 6, PR = 6
  const iW = W - PL - PR, iH = H - PT - PB
  const maxV = Math.max(...data.map(d => d.users), 1)
  const gap  = iW / 7, barW = gap * 0.58
  // Compute today in IST so the highlight matches the user's local date
  const istOffset = 5.5 * 60 * 60 * 1000
  const today = new Date(Date.now() + istOffset).toISOString().slice(0, 10)
  const DAY   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hasAny = data.some(d => d.users > 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible', marginTop: 8 }}>
      {data.map((d, i) => {
        const cx    = PL + gap * i + gap / 2
        const hasBar = d.users > 0
        const barH  = hasAny ? Math.max((d.users / maxV) * iH, hasBar ? 3 : 1) : 5
        const y     = PT + iH - barH
        const isCur = d.date === today
        // All active bars use the same cyan — only brightness differs for today
        const fill  = !hasAny ? 'rgba(34,211,238,0.12)'
          : isCur && hasBar  ? MON_CYAN
          : hasBar            ? 'rgba(34,211,238,0.45)'
          : 'rgba(34,211,238,0.1)'
        const lbl = DAY[new Date(d.date + 'T12:00:00Z').getDay()]
        return (
          <g key={d.date}>
            <rect x={cx - barW / 2} y={y} width={barW} height={barH} rx="3" fill={fill}
              style={isCur && hasBar ? { filter: 'drop-shadow(0 0 6px rgba(34,211,238,0.55))' } : undefined} />
            {hasBar && (
              <text x={cx} y={y - 5} textAnchor="middle" fontSize="9" fontWeight="600"
                fill="rgba(34,211,238,0.85)" fontFamily="system-ui,sans-serif">{d.users}</text>
            )}
            <text x={cx} y={H - 2} textAnchor="middle" fontSize="9"
              fill={isCur ? 'rgba(34,211,238,0.9)' : 'rgba(255,255,255,0.28)'}
              fontWeight={isCur ? '700' : '400'} fontFamily="system-ui,sans-serif">{lbl}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Upload job status donut
function MonJobDonut({ byStatus }) {
  const STATUS_CFG = [
    { key: 'ready',        label: 'Ready',        color: '#4ade80' },
    { key: 'uploading',    label: 'Uploading',    color: MON_CYAN  },
    { key: 'processing',   label: 'Processing',   color: '#a78bfa' },
    { key: 'queued',       label: 'Queued',       color: '#f472b6' },
    { key: 'awaiting_file',label: 'Awaiting',     color: 'rgba(255,255,255,0.2)' },
    { key: 'failed',       label: 'Failed',       color: '#f87171' },
  ]
  const segs = STATUS_CFG
    .map(s => ({ ...s, count: byStatus?.[s.key] || 0 }))
    .filter(s => s.count > 0)
  const total = segs.reduce((s, x) => s + x.count, 0) || 1
  const r = 36, cx = 48, cy = 48, C = 2 * Math.PI * r
  let cum = 0
  const drawn = segs.map(s => {
    const len = (s.count / total) * C
    const off = -(C * 0.25) - cum
    cum += len
    return { ...s, len, off }
  })
  if (!segs.length) return <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', margin: '12px 0 0' }}>No job data yet.</p>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
      <svg viewBox="0 0 96 96" width="100" height="100" style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="13" />
        {drawn.map(s => (
          <circle key={s.key} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth="12"
            strokeDasharray={`${s.len - 1.5} ${C - s.len + 1.5}`}
            strokeDashoffset={s.off}
            style={{ filter: `drop-shadow(0 0 3px ${s.color}55)` }} />
        ))}
        <text x={cx} y={cy - 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="white" fontFamily="system-ui,sans-serif">{total}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.38)" fontFamily="system-ui,sans-serif">jobs</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {drawn.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-text)', flex: 1 }}>{s.label}</span>
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: s.color }}>{s.count}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

// 6-month subscription trend — new vs churned side-by-side bars
function MonSubTrendChart({ data }) {
  if (!data?.length) return null
  const W = 560, H = 110, PT = 22, PB = 18, PL = 6, PR = 6
  const iW = W - PL - PR, iH = H - PT - PB
  const maxV  = Math.max(...data.flatMap(d => [d.newSubs, d.churned]), 1)
  const grpW  = (iW / data.length)
  const barW  = grpW * 0.32
  const gap   = grpW * 0.06
  const ABBR  = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible', marginTop: 8 }}>
      {data.map((d, i) => {
        const cx   = PL + grpW * i + grpW / 2
        const newH = Math.max((d.newSubs / maxV) * iH, d.newSubs > 0 ? 3 : 1)
        const chrH = Math.max((d.churned / maxV) * iH, d.churned > 0 ? 3 : 1)
        const month = parseInt(d.month.split('-')[1], 10)
        return (
          <g key={d.month}>
            <rect x={cx - barW - gap / 2} y={PT + iH - newH} width={barW} height={newH} rx="3"
              fill={MON_CYAN} style={{ filter: `drop-shadow(0 0 4px rgba(34,211,238,0.35))` }} />
            <rect x={cx + gap / 2} y={PT + iH - chrH} width={barW} height={chrH} rx="3"
              fill="#f87171" style={{ filter: `drop-shadow(0 0 3px rgba(248,113,113,0.3))` }} />
            <text x={cx} y={H - 2} textAnchor="middle" fontSize="9"
              fill="rgba(255,255,255,0.28)" fontFamily="system-ui,sans-serif">{ABBR[month]}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Top content list (last 24h) ───────────────────────────────────────────────
function MonTopContentList({ items }) {
  if (!items?.length) return (
    <p style={{ fontFamily:'var(--font-body)', fontSize:12, color:'rgba(255,255,255,0.25)', padding:'12px 0', margin:0 }}>
      No view events in the last 24h yet.
    </p>
  )
  const maxV = Math.max(...items.map(i => i.views), 1)
  const TYPE_COLOR = { Film:'#db2777', Series:'#a78bfa', 'Serial Drama':'#f472b6', Documentary:'#34d399', Live:'#fb923c' }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:8 }}>
      {items.map(item => {
        const pct   = Math.max((item.views / maxV) * 100, 2)
        const color = TYPE_COLOR[item.type] || MON_CYAN
        return (
          <div key={item.rank} style={{ display:'grid', gridTemplateColumns:'18px 1fr 40px', alignItems:'center', gap:10 }}>
            <span style={{ fontFamily:'var(--font-body)', fontSize:11, color:'rgba(255,255,255,0.28)', textAlign:'right' }}>#{item.rank}</span>
            <div>
              <div style={{ height:20, background:'rgba(255,255,255,0.04)', borderRadius:3, overflow:'hidden', position:'relative' }}>
                <div style={{ position:'absolute', top:0, left:0, height:'100%', width:`${pct}%`, background:`${color}55`, transition:'width 0.5s ease' }} />
                <span style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', fontFamily:'var(--font-body)', fontSize:11, fontWeight:500, color:'var(--color-text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'calc(100% - 16px)' }}>
                  {item.title.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()}
                </span>
              </div>
            </div>
            <span style={{ fontFamily:'var(--font-display)', fontSize:12, fontWeight:700, color, textAlign:'right' }}>{item.views}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Device split mini donut ───────────────────────────────────────────────────
function MonDeviceDonut({ devices }) {
  const CFG = [
    { key:'mobile',  label:'Mobile',  color:'#22d3ee' },
    { key:'desktop', label:'Desktop', color:'#a78bfa' },
    { key:'tv',      label:'TV',      color:'#db2777' },
    { key:'unknown', label:'Other',   color:'rgba(255,255,255,0.2)' },
  ]
  const segs = CFG.map(c => ({ ...c, count: devices?.find(d => d.device === c.key)?.count || 0 })).filter(s => s.count > 0)
  const total = segs.reduce((s, x) => s + x.count, 0) || 1
  const r = 28, cx = 36, cy = 36, C = 2 * Math.PI * r
  let cum = 0
  const drawn = segs.map(s => {
    const len = (s.count / total) * C
    const off = -(C * 0.25) - cum; cum += len
    return { ...s, len, off, pct: Math.round((s.count / total) * 100) }
  })
  if (!drawn.length) return <p style={{ fontFamily:'var(--font-body)', fontSize:12, color:'rgba(255,255,255,0.25)', margin:'8px 0 0' }}>No device data yet.</p>
  return (
    <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:8 }}>
      <svg viewBox="0 0 72 72" width="76" height="76" style={{ flexShrink:0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
        {drawn.map(s => (
          <circle key={s.key} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth="9"
            strokeDasharray={`${s.len - 1} ${C - s.len + 1}`} strokeDashoffset={s.off}
            style={{ filter:`drop-shadow(0 0 3px ${s.color}55)` }} />
        ))}
      </svg>
      <div style={{ display:'flex', flexDirection:'column', gap:6, flex:1 }}>
        {drawn.map(s => (
          <div key={s.key} style={{ display:'flex', alignItems:'center', gap:7 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:s.color, flexShrink:0 }} />
            <span style={{ fontFamily:'var(--font-body)', fontSize:11, color:'var(--color-text)', flex:1 }}>{s.label}</span>
            <strong style={{ fontFamily:'var(--font-display)', fontSize:12, color:s.color }}>{s.pct}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Geography bars (top 5 states) ─────────────────────────────────────────────
function MonGeoList({ states }) {
  // Filter out "Unknown" entries — these come from localhost or unresolvable IPs
  const known = (states || []).filter(s => s.state && s.state !== 'Unknown')
  const allUnknown = (states || []).length > 0 && known.length === 0

  if (!states?.length) return (
    <p style={{ fontFamily:'var(--font-body)', fontSize:12, color:'rgba(255,255,255,0.25)', margin:'8px 0 0' }}>
      No location data yet.
    </p>
  )
  if (allUnknown) return (
    <p style={{ fontFamily:'var(--font-body)', fontSize:12, color:'rgba(255,255,255,0.25)', margin:'8px 0 0' }}>
      Location unavailable — views from local / unresolvable IPs.
    </p>
  )

  const maxV = Math.max(...known.map(s => s.count), 1)
  const fmtV = (v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:7, marginTop:8 }}>
      {known.map((s, i) => (
        <div key={s.state} style={{ display:'grid', gridTemplateColumns:'20px 1fr 60px 36px', alignItems:'center', gap:8 }}>
          <span style={{ fontFamily:'var(--font-body)', fontSize:10, color:'rgba(255,255,255,0.22)', textAlign:'right' }}>#{i + 1}</span>
          <span style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--color-text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.state}</span>
          <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${(s.count / maxV) * 100}%`, background: i === 0 ? MON_CYAN : 'rgba(34,211,238,0.45)', borderRadius:2, transition:'width 0.5s ease' }} />
          </div>
          <span style={{ fontFamily:'var(--font-body)', fontSize:11, color:MON_CYAN, textAlign:'right' }}>{fmtV(s.count)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Revenue dashboard — tier colours ─────────────────────────────────────────
const TIER_COLORS = {
  'Featured':    '#c4b5fd',
  'Established': '#a78bfa',
  'Rising Star': '#8b5cf6',
  'Newcomer':    '#6366f1',
}

// ── 12-month revenue bar chart ────────────────────────────────────────────────
function RevMonthlyBarsChart({ data }) {
  const ABBR = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const W = 560, H = 110, PT = 22, PB = 20, PL = 6, PR = 6
  const iW = W - PL - PR, iH = H - PT - PB
  const now = new Date()
  // Generate 12 calendar months, filling gaps with 0
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    const y = d.getFullYear(), m = d.getMonth() + 1
    const found = (data || []).find(x => x.year === y && x.month === m)
    return { y, m, rev: found?.revenuePaise || 0 }
  })
  const maxV = Math.max(...months.map(x => x.rev), 1)
  const gap  = iW / 12, barW = gap * 0.58
  const fmt  = (p) => {
    const r = p / 100
    return r >= 100000 ? `₹${(r/100000).toFixed(1)}L` : r >= 1000 ? `₹${(r/1000).toFixed(1)}k` : `₹${Math.round(r)}`
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block', overflow:'visible', marginTop:8 }}>
      {months.map(({ y, m, rev }, i) => {
        const cx   = PL + gap * i + gap / 2
        const barH = Math.max((rev / maxV) * iH, rev > 0 ? 3 : 1)
        const vy   = PT + iH - barH
        const isCur = y === now.getFullYear() && m === now.getMonth() + 1
        return (
          <g key={`${y}-${m}`}>
            <rect x={cx - barW/2} y={vy} width={barW} height={barH} rx="3"
              fill={isCur ? '#db2777' : 'rgba(219,39,119,0.32)'}
              style={isCur ? { filter:'drop-shadow(0 0 6px rgba(219,39,119,0.5))' } : undefined} />
            {rev > 0 && (
              <text x={cx} y={vy - 5} textAnchor="middle" fontSize="8" fontWeight="600"
                fill="rgba(219,39,119,0.85)" fontFamily="system-ui,sans-serif">{fmt(rev)}</text>
            )}
            <text x={cx} y={H - 2} textAnchor="middle" fontSize="8"
              fill={isCur ? 'rgba(219,39,119,0.9)' : 'rgba(255,255,255,0.28)'}
              fontWeight={isCur ? '700' : '400'} fontFamily="system-ui,sans-serif">{ABBR[m]}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Plan mix donut ────────────────────────────────────────────────────────────
function PlanDonutChart({ data }) {
  const PLANS = [
    { key: 'monthly', label: 'Monthly ₹99',  color: '#db2777' },
    { key: 'annual',  label: 'Annual ₹599',  color: '#fb923c' },
    { key: 'family',  label: 'Family ₹999',  color: '#f472b6' },
  ].map(p => ({
    ...p,
    paise: (data || []).find(d => d.plan === p.key)?.revenuePaise || 0,
    count: (data || []).find(d => d.plan === p.key)?.transactionCount || 0,
  })).filter(p => p.paise > 0)

  const total = PLANS.reduce((s, p) => s + p.paise, 0) || 1
  const r = 38, cx = 50, cy = 50, C = 2 * Math.PI * r
  let cum = 0
  const segs = PLANS.map(p => {
    const len = (p.paise / total) * C
    const off = -(C * 0.25) - cum
    cum += len
    return { ...p, len, off, pct: Math.round((p.paise / total) * 100) }
  })
  const fmtRs = (p) => {
    const r = p / 100
    return r >= 100000 ? `₹${(r/100000).toFixed(1)}L` : r >= 1000 ? `₹${(r/1000).toFixed(1)}k` : `₹${Math.round(r)}`
  }
  if (!segs.length) return <p style={{ fontSize:12, color:'rgba(255,255,255,0.25)', margin:0 }}>No plan data yet.</p>
  return (
    <div style={{ display:'flex', alignItems:'center', gap:16, padding:'8px 0' }}>
      <svg viewBox="0 0 100 100" width="110" height="110" style={{ flexShrink:0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" />
        {segs.map(seg => (
          <circle key={seg.key} cx={cx} cy={cy} r={r} fill="none"
            stroke={seg.color} strokeWidth="13"
            strokeDasharray={`${seg.len - 1.5} ${C - seg.len + 1.5}`}
            strokeDashoffset={seg.off}
            style={{ filter:`drop-shadow(0 0 4px ${seg.color}55)` }} />
        ))}
        <text x={cx} y={cy - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="system-ui,sans-serif">
          {fmtRs(total)}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.38)" fontFamily="system-ui,sans-serif">total</text>
      </svg>
      <div style={{ display:'flex', flexDirection:'column', gap:9, flex:1 }}>
        {segs.map(seg => (
          <div key={seg.key} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:seg.color, flexShrink:0 }} />
            <span style={{ fontFamily:'var(--font-body)', fontSize:12, color:'var(--color-text)', flex:1 }}>{seg.label}</span>
            <strong style={{ fontFamily:'var(--font-display)', fontSize:13, color:seg.color }}>{seg.pct}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Subscriber health stacked bar ─────────────────────────────────────────────
function SubHealthBarChart({ data }) {
  const STATUSES = [
    { key: 'active', label: 'Active',  color: '#4ade80' },
    { key: 'trial',  label: 'Trial',   color: '#38bdf8' },
    { key: 'grace',  label: 'Grace',   color: '#f472b6' },
    { key: 'lapsed', label: 'Lapsed',  color: '#f87171' },
    { key: 'free',   label: 'Free',    color: 'rgba(255,255,255,0.12)' },
  ]
  const counts = STATUSES.map(s => ({ ...s, n: (data || {})[s.key] || 0 }))
  const total  = counts.reduce((s, x) => s + x.n, 0) || 1
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:10 }}>
      <div style={{ height:10, borderRadius:99, overflow:'hidden', display:'flex', background:'rgba(255,255,255,0.04)' }}>
        {counts.filter(s => s.n > 0).map(s => (
          <div key={s.key}
            style={{ width:`${(s.n / total) * 100}%`, minWidth:2, height:'100%', background:s.color, transition:'width 0.6s ease' }}
            title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'8px 20px' }}>
        {counts.filter(s => s.n > 0).map(s => (
          <span key={s.key} style={{ display:'flex', alignItems:'center', gap:6, fontFamily:'var(--font-body)', fontSize:12, color:'var(--color-text-muted)' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:s.color, flexShrink:0 }} />
            {s.label} <strong style={{ color:'var(--color-text)' }}>{s.n.toLocaleString()}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Top creators horizontal bars ──────────────────────────────────────────────
function CreatorEarningsBarsChart({ data }) {
  if (!data?.length) return <p style={{ fontSize:12, color:'rgba(255,255,255,0.25)', margin:'8px 0 0', textAlign:'center' }}>No creator earnings yet.</p>
  const sorted  = [...data].sort((a, b) => b.totalEarned - a.totalEarned).slice(0, 8)
  const maxEarn = Math.max(...sorted.map(c => c.totalEarned), 1)
  const fmt     = (n) => n >= 1000 ? `₹${(n/1000).toFixed(1)}k` : `₹${n}`
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:8 }}>
      {sorted.map(c => {
        const totalPct = Math.max((c.totalEarned / maxEarn) * 100, 1)
        const paidPct  = c.totalEarned > 0 ? (c.paidOut / c.totalEarned) * totalPct : 0
        const color    = TIER_COLORS[c.tier] || '#6366f1'
        return (
          <div key={String(c.creatorId)} style={{ display:'grid', gridTemplateColumns:'160px 1fr 110px', alignItems:'center', gap:12 }}>
            <div style={{ overflow:'hidden' }}>
              <p style={{ margin:0, fontFamily:'var(--font-body)', fontSize:12, fontWeight:600, color:'var(--color-text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {c.studioName}
              </p>
              <span style={{ fontFamily:'var(--font-body)', fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:99, border:`1px solid ${color}44`, color, background:'transparent' }}>
                {c.tier}
              </span>
            </div>
            <div style={{ position:'relative', height:20, background:'rgba(255,255,255,0.04)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ position:'absolute', top:0, left:0, height:'100%', width:`${totalPct}%`, background:`${color}22`, border:`1px solid ${color}33`, borderRadius:4 }} />
              <div style={{ position:'absolute', top:0, left:0, height:'100%', width:`${paidPct}%`, background:color, borderRadius:4, transition:'width 0.6s ease' }} />
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:13, fontWeight:700, color }}>{fmt(c.totalEarned)}</div>
              {c.pending > 0 && (
                <div style={{ fontFamily:'var(--font-body)', fontSize:10, color:'#f472b6' }}>₹{c.pending.toLocaleString('en-IN')} pending</div>
              )}
            </div>
          </div>
        )
      })}
      <div style={{ display:'flex', gap:16, fontFamily:'var(--font-body)', fontSize:11, color:'rgba(255,255,255,0.35)', marginTop:4 }}>
        <span><span style={{ display:'inline-block', width:12, height:8, borderRadius:2, background:'rgba(99,102,241,0.2)', marginRight:5, verticalAlign:'middle' }}/>Total Earned</span>
        <span><span style={{ display:'inline-block', width:12, height:8, borderRadius:2, background:'#6366f1', marginRight:5, verticalAlign:'middle' }}/>Paid Out</span>
      </div>
    </div>
  )
}

const TABS = [
  { id: 'content',  label: 'Content',         icon: Library      },
  { id: 'uploads',  label: 'Uploads',         icon: UploadCloud  },
  { id: 'shelves',  label: 'Shelves',         icon: Layers       },
  { id: 'payments', label: 'Payments',        icon: CreditCard   },
  { id: 'creators', label: 'Creator Hub',     icon: UserCheck    },
  { id: 'revenue',  label: 'Creator Revenue', icon: IndianRupee  },
  { id: 'monitor',  label: 'Monitor',         icon: Activity     },
]

const NEW_CONTENT_ID = '__new__'

// ── Video frame extraction helpers (shared with reel upload) ─────────────────

function analyseVideoFrame(file) {
  return new Promise((resolve) => {
    const video  = document.createElement('video')
    const canvas = document.createElement('canvas')
    const url    = URL.createObjectURL(file)
    let   settled = false

    const finish = () => {
      if (settled) return
      settled = true
      const { videoWidth: w, videoHeight: h } = video
      let thumb = null
      try {
        const scale = w > 0 ? Math.min(1, 480 / w) : 1
        canvas.width  = Math.round(w * scale) || 480
        canvas.height = Math.round(h * scale) || 270
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        thumb = canvas.toDataURL('image/jpeg', 0.85)
      } catch {}
      URL.revokeObjectURL(url)
      resolve(thumb)
    }

    video.preload = 'auto'
    video.onloadedmetadata = () => { video.currentTime = Math.min(1e-5, video.duration) }
    video.onseeked      = finish
    video.onloadeddata  = () => setTimeout(() => { if (!settled) finish() }, 200)
    video.onerror       = () => { URL.revokeObjectURL(url); resolve(null) }
    video.src = url
  })
}

function dataUrlToFile(dataUrl, filename) {
  const [header, data] = dataUrl.split(',')
  const mime  = header.match(/:(.*?);/)[1]
  const bytes = atob(data)
  const arr   = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], filename, { type: mime })
}

const EMPTY_EDIT_FORM = {
  title: '', subtitle: '', desc: '', type: 'Film', duration: '',
  genre: '', cast: '', director: '', releaseYear: '', rating: '',
  isPremium: false, isFeatured: false, badge: '',
  posterUrl: '', backdropUrl: '', palette: '', reviewCount: '',
  contentLanguage: 'Bengali', certification: '', contentWarnings: '',
  moodTags: '', bunnyVideoId: '', episodes: [],
}

const SHELF_ACCENT_COLORS = [
  { hex: '#db2777', name: 'Rose'    },
  { hex: '#dc2626', name: 'Crimson' },
  { hex: '#d97706', name: 'Amber'   },
  { hex: '#ca8a04', name: 'Gold'    },
  { hex: '#16a34a', name: 'Emerald' },
  { hex: '#0d9488', name: 'Teal'    },
  { hex: '#0ea5e9', name: 'Sky'     },
  { hex: '#2563eb', name: 'Cobalt'  },
  { hex: '#7c3aed', name: 'Violet'  },
  { hex: '#64748b', name: 'Slate'   },
]

const EMPTY_SHELF = { name: '', tagline: '', backdropUrl: '', accentColor: '#db2777', contentIds: [] }

const statusClass = {
  awaiting_file: styles.statusAwaiting,
  queued:        styles.statusQueued,
  uploading:     styles.statusUploading,
  processing:    styles.statusProcessing,
  ready:         styles.statusReady,
  failed:        styles.statusFailed,
}

export default function Admin() {
  const { authLoading } = useStore()
  const [sessionLoading, setSessionLoading] = useState(true)
  const [adminAllowed, setAdminAllowed]     = useState(false)
  const [sessionError, setSessionError]     = useState('')
  const [activeTab, setActiveTab]           = useState('content')

  // ── Data ──────────────────────────────────────────────────────────────────
  const [collections, setCollections]       = useState([])
  const [bunnyCollections, setBunnyCollections] = useState([])
  const [bunnyVideos, setBunnyVideos]       = useState([])
  const [contentItems, setContentItems]     = useState([])
  const [jobs, setJobs]                     = useState([])

  // ── Upload form ───────────────────────────────────────────────────────────
  const [collectionMode, setCollectionMode] = useState('pick') // 'pick' | 'create'
  const [collectionName, setCollectionName] = useState('')
  const [bunnyCollectionId, setBunnyCollectionId] = useState('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [title, setTitle]                   = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState('')
  const [selectedContentId, setSelectedContentId]       = useState('')
  // Episode upload fields — only used when selected content is a Series
  const [uploadCategory, setUploadCategory] = useState('Film')   // 'Film' | 'Series' | 'Serial Drama' | 'Documentary'
  const [seasonNumber, setSeasonNumber]     = useState('1')
  const [episodeNumber, setEpisodeNumber]   = useState('')
  const [episodeTitle, setEpisodeTitle]     = useState('')
  const [episodeDuration, setEpisodeDuration] = useState('')
  const [seriesEpisodes, setSeriesEpisodes] = useState([])   // existing episodes across all seasons
  const [loadingSeriesEpisodes, setLoadingSeriesEpisodes] = useState(false)
  const [mapSeasonNumber, setMapSeasonNumber] = useState('1')
  const [mapEpisodeNumber, setMapEpisodeNumber] = useState('')
  // Bulk upload mode (single vs. bulk queue for series)
  const [uploadMode, setUploadMode]         = useState('single') // 'single' | 'bulk'
  const bulkRowIdRef                        = useRef(1)
  const fileInputRef                        = useRef(null)
  const [bulkRows, setBulkRows]             = useState([
    { id: 0, number: '', title: '', duration: '', file: null, status: 'idle', progress: 0, error: '' },
  ])
  const [bulkBusy, setBulkBusy]             = useState(false)
  // Drag-to-reorder state for episode rows in the edit modal
  const [dragEpIdx, setDragEpIdx]           = useState(null)
  const [mapCollectionId, setMapCollectionId] = useState('')
  const [mapVideoId, setMapVideoId]           = useState('')
  const [mapContentId, setMapContentId]       = useState('')
  const [mapVideoError, setMapVideoError]     = useState('')
  const [file, setFile]                       = useState(null)
  const [busy, setBusy]                       = useState(false)
  const [uploadProgress, setUploadProgress]   = useState(0)
  const [notice, setNotice]                   = useState('')
  const [error, setError]                     = useState('')
  const [dragOver, setDragOver]               = useState(false)
  const [autoThumbUploading, setAutoThumbUploading] = useState(false)
  const [toast, setToast]                     = useState(null)
  const [jobsLastRefreshed, setJobsLastRefreshed] = useState(null)
  const [isRefreshing, setIsRefreshing]        = useState(false)
  const [refreshCountdown, setRefreshCountdown] = useState(5)

  // ── Payment provider ──────────────────────────────────────────────────────
  const [paymentConfig, setPaymentConfig]   = useState(null)
  const [paymentBusy, setPaymentBusy]       = useState(false)
  const [copiedWebhook, setCopiedWebhook]   = useState(null)
  const [showLiveConfirm, setShowLiveConfirm] = useState(false)
  const [liveConfirmText, setLiveConfirmText] = useState('')

  // ── Reels Review ─────────────────────────────────────────────────────────
  const [adminReels,          setAdminReels]          = useState([])
  const [reelsFilter,         setReelsFilter]         = useState('pending')
  const [reelsLoading,        setReelsLoading]        = useState(false)
  const [reelPreview,         setReelPreview]         = useState(null)   // reel being previewed
  const [reelRejectModal,     setReelRejectModal]     = useState(null)   // reel being rejected
  const [reelRejectReason,    setReelRejectReason]    = useState('')
  const [reelBusy,            setReelBusy]            = useState(false)

  // ── Creator Hub ───────────────────────────────────────────────────────────
  const [creatorApplications, setCreatorApplications] = useState([])
  const [submissions, setSubmissions]                 = useState([])
  const [creatorHubTab, setCreatorHubTab]             = useState('applications')
  const [appStatusFilter, setAppStatusFilter]         = useState('all')
  const [subStatusFilter, setSubStatusFilter]         = useState('pending')
  const [creatorBusy, setCreatorBusy]                 = useState(false)
  const [rejectModal, setRejectModal]                 = useState(null)
  const [rejectReason, setRejectReason]               = useState('')

  // ── Creator Revenue ──────────────────────────────────────────────────────
  const [creatorEarnings,    setCreatorEarnings]    = useState([])
  const [creatorPayouts,     setCreatorPayouts]     = useState([])
  const [revenueLoading,     setRevenueLoading]     = useState(false)
  const [showCalcModal,      setShowCalcModal]      = useState(false)
  const [calcForm,           setCalcForm]           = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear(), ratePerViewPaise: 50 })
  const [calcBusy,           setCalcBusy]           = useState(false)
  const [calcResult,         setCalcResult]         = useState(null)
  const [showPayoutModal,    setShowPayoutModal]     = useState(null)  // { creatorId, studioName, pending }
  const [payoutForm,         setPayoutForm]         = useState({ method: 'Bank Transfer', referenceId: '', notes: '' })
  const [payoutBusy,         setPayoutBusy]         = useState(false)
  const [revenueNotice,      setRevenueNotice]      = useState('')
  const [revenueError,       setRevenueError]       = useState('')
  const [platformRevenue,    setPlatformRevenue]    = useState(null)

  // ── Monitor ───────────────────────────────────────────────────────────────
  const [monitorData,        setMonitorData]        = useState(null)
  const [monitorLoading,     setMonitorLoading]     = useState(false)
  const [monitorLastFetched, setMonitorLastFetched] = useState(null)

  // ── Curated Shelves ───────────────────────────────────────────────────────
  const [shelves,          setShelves]          = useState([])
  const [shelvesLoading,   setShelvesLoading]   = useState(false)
  const [showShelfModal,   setShowShelfModal]   = useState(false)
  const [editingShelfId,   setEditingShelfId]   = useState(null)
  const [shelfForm,        setShelfForm]        = useState(EMPTY_SHELF)
  const [shelfBusy,        setShelfBusy]        = useState(false)
  const [shelfNotice,      setShelfNotice]      = useState('')
  const [shelfError,       setShelfError]       = useState('')
  const [shelfImgUploading, setShelfImgUploading] = useState(false)
  const [shelfContentSearch, setShelfContentSearch] = useState('')
  const [dragShelfIdx,     setDragShelfIdx]     = useState(null)
  const [dragOverShelfIdx, setDragOverShelfIdx] = useState(null)

  // ── Content editor ────────────────────────────────────────────────────────
  const [editingId, setEditingId]     = useState(null)
  const [editForm, setEditForm]       = useState(null)
  const [editBusy, setEditBusy]       = useState(false)
  const [editNotice, setEditNotice]   = useState('')
  const [editError, setEditError]     = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [imgUploading, setImgUploading]   = useState({ poster: false, backdrop: false })
  const [imgProgress,  setImgProgress]    = useState({ poster: 0,     backdrop: 0     })
  const modalFormRef = useRef(null)

  // ── Helpers ───────────────────────────────────────────────────────────────
  const showToast = useCallback((t) => {
    setToast(t)
    setTimeout(() => setToast(null), 5000)
  }, [])

  const { requestPermission, checkTransitions } = useUploadNotifier(showToast)

  const selectedCollection = useMemo(
    () => collections.find((c) => c._id === selectedCollectionId),
    [collections, selectedCollectionId]
  )

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadData = async () => {
    // Bunny and payments are external services — catch individually so a
    // misconfigured API key never blocks access to the rest of the admin panel.
    const [collectionData, contentData, jobData, bunnyCollectionData, paymentData] = await Promise.all([
      listAdminCollections(),
      listAdminContent(),
      listUploadJobs(40).catch(() => []),
      listBunnyCollections().catch(() => []),
      getPaymentConfig().catch(() => null),
    ])
    setCollections(collectionData)
    setContentItems(contentData)
    setJobs(jobData)
    setJobsLastRefreshed(new Date())
    setBunnyCollections(bunnyCollectionData)
    if (paymentData) setPaymentConfig(paymentData)
  }

  const loadBunnyVideos = async (collectionId) => {
    setMapVideoError('')
    if (!collectionId) { setBunnyVideos([]); return }
    try {
      const items = await listBunnyVideos({ collectionId })
      setBunnyVideos(items)
      if (!items.length) setMapVideoError('No videos found in this collection.')
    } catch (err) {
      setMapVideoError(err?.message || 'Could not load videos.')
    }
  }

  useEffect(() => {
    if (authLoading) return
    let active = true
    ;(async () => {
      setSessionLoading(true)
      setSessionError('')
      try {
        await getAdminSession()
        if (!active) return
        setAdminAllowed(true)
        // loadData failures (e.g. Bunny unavailable) must not revoke admin access
        await loadData().catch(() => {})
      } catch (err) {
        // Only auth errors reach here — data errors are swallowed in loadData
        if (!active) return
        setAdminAllowed(false)
        setSessionError(err?.message || 'Admin access required.')
      } finally {
        if (active) setSessionLoading(false)
      }
    })()
    return () => { active = false }
  }, [authLoading])

  useEffect(() => {
    if (!adminAllowed) return undefined
    requestPermission()
    const INTERVAL = 5
    let count = INTERVAL
    setRefreshCountdown(INTERVAL)
    const tick = setInterval(() => {
      count -= 1
      setRefreshCountdown(count)
      if (count <= 0) {
        count = INTERVAL
        setRefreshCountdown(INTERVAL)
        setIsRefreshing(true)
        listUploadJobs(40)
          .then((jobs) => { setJobs(jobs); setJobsLastRefreshed(new Date()); checkTransitions(jobs) })
          .catch(() => {})
          .finally(() => setIsRefreshing(false))
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [adminAllowed, requestPermission, checkTransitions])


  useEffect(() => {
    if (editForm && modalFormRef.current) modalFormRef.current.scrollTop = 0
  }, [editForm])

  useEffect(() => {
    if (activeTab === 'creators' && adminAllowed) {
      void loadCreatorApplications()
      void loadSubmissions()
      void loadAdminReels()
    }
    if (activeTab === 'shelves' && adminAllowed) {
      void loadShelves()
    }
    if (activeTab === 'revenue' && adminAllowed) {
      void loadCreatorRevenue()
    }
    if (activeTab === 'monitor' && adminAllowed) {
      void loadMonitor()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminAllowed])

  // ── Payment handlers ──────────────────────────────────────────────────────
  const handleSetProvider = async (provider) => {
    setPaymentBusy(true)
    try {
      const updated = await updatePaymentConfig({ activeProvider: provider })
      setPaymentConfig((prev) => ({ ...prev, ...updated }))
      showToast({ type: 'success', message: `Switched to ${provider}` })
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not switch provider.' })
    } finally {
      setPaymentBusy(false)
    }
  }

  const handleSetMode = async (mode) => {
    if (mode === 'live') { setShowLiveConfirm(true); return }
    setPaymentBusy(true)
    try {
      const updated = await updatePaymentConfig({ mode })
      setPaymentConfig((prev) => ({ ...prev, ...updated }))
      showToast({ type: 'success', message: 'Switched to Test mode' })
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not update mode.' })
    } finally {
      setPaymentBusy(false)
    }
  }

  const handleConfirmLive = async () => {
    setShowLiveConfirm(false)
    setLiveConfirmText('')
    setPaymentBusy(true)
    try {
      const updated = await updatePaymentConfig({ mode: 'live' })
      setPaymentConfig((prev) => ({ ...prev, ...updated }))
      showToast({ type: 'success', message: 'Live mode activated — real payments enabled' })
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not activate live mode.' })
    } finally {
      setPaymentBusy(false)
    }
  }

  const copyWebhookUrl = (provider, url) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedWebhook(provider)
      setTimeout(() => setCopiedWebhook(null), 2000)
    })
  }

  // ── Quick premium toggle (no modal needed) ───────────────────────────────
  const [togglingPremium, setTogglingPremium]   = useState(null)
  const [togglingPublish, setTogglingPublish]   = useState(null)
  const [confirmDeleteId, setConfirmDeleteId]   = useState(null)

  const handleTogglePremium = async (item) => {
    setTogglingPremium(item._id)
    // Optimistic update
    setContentItems((prev) =>
      prev.map((c) => c._id === item._id ? { ...c, isPremium: !item.isPremium } : c)
    )
    try {
      await updateAdminContent(item._id, { isPremium: !item.isPremium })
    } catch {
      // Revert on failure
      setContentItems((prev) =>
        prev.map((c) => c._id === item._id ? { ...c, isPremium: item.isPremium } : c)
      )
    } finally {
      setTogglingPremium(null)
    }
  }

  const handleTogglePublish = async (item) => {
    const next = !item.isPublished
    setTogglingPublish(item._id)
    setContentItems((prev) =>
      prev.map((c) => c._id === item._id ? { ...c, isPublished: next } : c)
    )
    try {
      await togglePublishContent(item._id, next)
      showToast({ type: 'success', message: next ? 'Content published' : 'Content unpublished' })
    } catch (err) {
      setContentItems((prev) =>
        prev.map((c) => c._id === item._id ? { ...c, isPublished: item.isPublished } : c)
      )
      showToast({ type: 'error', message: err?.message || 'Could not update publish state' })
    } finally {
      setTogglingPublish(null)
    }
  }

  const handleDeleteContent = async (item) => {
    if (confirmDeleteId !== item._id) { setConfirmDeleteId(item._id); return }
    setConfirmDeleteId(null)
    setContentItems((prev) => prev.filter((c) => c._id !== item._id))
    try {
      await deleteAdminContent(item._id)
      showToast({ type: 'success', message: `"${item.title}" deleted` })
    } catch (err) {
      await loadData()
      showToast({ type: 'error', message: err?.message || 'Could not delete content' })
    }
  }

  // ── Content editor handlers ───────────────────────────────────────────────
  const openEditModal = async (item) => {
    setEditNotice('')
    setEditError('')
    setEditingId(item._id)
    setEditBusy(true)
    try {
      const full = await fetchAdminContentById(item._id)
      setEditForm({
        title:           full.title           || '',
        subtitle:        full.subtitle         || '',
        desc:            full.desc             || '',
        type:            full.type             || 'Film',
        duration:        full.duration         || '',
        genre:           (full.genre          || []).join(', '),
        cast:            (full.cast           || []).join(', '),
        director:        full.director         || '',
        releaseYear:     full.releaseYear != null ? String(full.releaseYear) : '',
        rating:          full.rating      != null ? String(full.rating)      : '',
        isPremium:       Boolean(full.isPremium),
        isFeatured:      Boolean(full.isFeatured),
        badge:           full.badge            || '',
        posterUrl:       full.posterUrl        || '',
        backdropUrl:     full.backdropUrl      || '',
        bunnyVideoId:    full.bunnyVideoId     || '',
        palette:         full.palette          || '',
        reviewCount:     full.reviewCount != null ? String(full.reviewCount) : '',
        contentLanguage: full.contentLanguage  || 'Bengali',
        certification:   full.certification    || '',
        contentWarnings: full.contentWarnings  || '',
        moodTags:        (full.moodTags        || []).join(', '),
        episodes:        (full.episodes        || []).map((ep) => ({
          number:      ep.number,
          title:       ep.title       || '',
          duration:    ep.duration    || '',
          bunnyVideoId: ep.bunnyVideoId || '',
        })),
      })
    } catch (err) {
      setEditError(err?.message || 'Could not load content.')
      setEditingId(null)
    } finally {
      setEditBusy(false)
    }
  }

  const closeEditModal = () => {
    setEditingId(null); setEditForm(null)
    setEditNotice('');  setEditError('')
  }

  const openCreateModal = (prefill = null) => {
    setEditingId(NEW_CONTENT_ID)
    setEditForm(prefill ? { ...EMPTY_EDIT_FORM, ...prefill } : EMPTY_EDIT_FORM)
    setEditNotice(''); setEditError('')
  }

  const handleEditSave = async (e) => {
    e.preventDefault()
    setEditNotice(''); setEditError(''); setEditBusy(true)
    try {
      const payload = {
        title:           editForm.title.trim(),
        subtitle:        editForm.subtitle.trim(),
        desc:            editForm.desc.trim(),
        type:            editForm.type,
        duration:        (editForm.type !== 'Series' && editForm.type !== 'Serial Drama') ? (editForm.duration?.trim() || '') : '',
        genre:           editForm.genre.split(',').map((s) => s.trim()).filter(Boolean),
        cast:            editForm.cast.split(',').map((s) => s.trim()).filter(Boolean),
        director:        editForm.director.trim(),
        releaseYear:     editForm.releaseYear ? Number(editForm.releaseYear) : null,
        rating:          editForm.rating      ? Number(editForm.rating)      : 0,
        isPremium:       editForm.isPremium,
        isFeatured:      editForm.isFeatured,
        badge:           editForm.badge.trim() || null,
        posterUrl:       editForm.posterUrl.trim(),
        backdropUrl:     editForm.backdropUrl.trim(),
        palette:         editForm.palette.trim(),
        reviewCount:     editForm.reviewCount ? Number(editForm.reviewCount) : 0,
        contentLanguage: editForm.contentLanguage || 'Bengali',
        certification:   editForm.certification || null,
        contentWarnings: editForm.contentWarnings.trim(),
        moodTags:        editForm.moodTags.split(',').map((s) => s.trim()).filter(Boolean),
        episodes:        (editForm.episodes || []).map((ep) => ({
          number:      Number(ep.number),
          title:       ep.title.trim(),
          duration:    ep.duration.trim(),
          bunnyVideoId: ep.bunnyVideoId?.trim() || '',
        })),
      }

      if (editingId === NEW_CONTENT_ID) {
        // ── Create mode ──
        const created = await createAdminContent(payload)
        await loadData()
        // Switch to edit mode so admin can see the "Go to Uploads" CTA
        setEditingId(created._id)
        setEditNotice(`"${created.title}" created successfully!`)
      } else {
        // ── Edit mode ──
        await updateAdminContent(editingId, payload)
        setEditNotice('Metadata saved.')
        await loadData()
      }
    } catch (err) {
      setEditError(err?.message || 'Could not save.')
    } finally {
      setEditBusy(false)
    }
  }

  const ef = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setEditForm((prev) => ({ ...prev, [field]: val }))
  }

  const filteredContent = useMemo(() => {
    if (!contentSearch.trim()) return contentItems
    const q = contentSearch.toLowerCase()
    return contentItems.filter((c) =>
      c.title?.toLowerCase().includes(q) || c.type?.toLowerCase().includes(q)
    )
  }, [contentItems, contentSearch])

  // Set of contentIds that still have an active transcoding job
  const processingContentIds = useMemo(() => {
    const active = new Set()
    for (const job of jobs) {
      if (job.contentId && ['queued', 'uploading', 'processing'].includes(job.status)) {
        active.add(typeof job.contentId === 'object' ? job.contentId._id ?? job.contentId : job.contentId)
      }
    }
    return active
  }, [jobs])

  const handleImageUpload = async (field, file) => {
    if (!file) return
    setImgUploading((p) => ({ ...p, [field]: true }))
    setImgProgress((p)  => ({ ...p, [field]: 0 }))
    try {
      const url = await uploadToCloudinary(file, {
        folder: 'dhara',
        onProgress: (pct) => setImgProgress((p) => ({ ...p, [field]: pct })),
      })
      setEditForm((prev) => ({ ...prev, [field]: url }))
    } catch (err) {
      setEditError(err?.message || 'Image upload failed.')
    } finally {
      setImgUploading((p) => ({ ...p, [field]: false }))
    }
  }

  // ── Creator Hub loaders ───────────────────────────────────────────────────
  const loadMonitor = async () => {
    setMonitorLoading(true)
    try {
      const data = await getAdminMonitor()
      setMonitorData(data)
      setMonitorLastFetched(new Date())
    } catch (err) {
      console.error('[monitor] fetch failed:', err?.message || err)
      showToast({ type: 'error', message: `Monitor error: ${err?.message || 'Could not load data'}` })
    }
    finally { setMonitorLoading(false) }
  }

  const loadAdminReels = async () => {
    // Always fetch all reels — filter client-side so chip counts stay accurate
    // regardless of which tab is active.
    setReelsLoading(true)
    try {
      const data = await listAdminReels({ status: 'all', limit: 100 })
      setAdminReels(data.items || [])
    } catch { setAdminReels([]) }
    finally { setReelsLoading(false) }
  }

  const loadCreatorApplications = async (status = appStatusFilter) => {
    try {
      const data = await listCreatorApplications({ status })
      setCreatorApplications(data)
    } catch { /* non-critical */ }
  }

  const loadSubmissions = async (status = subStatusFilter) => {
    try {
      const data = await listAdminSubmissions({ status })
      setSubmissions(data)
    } catch { /* non-critical */ }
  }

  // ── Creator Hub handlers ──────────────────────────────────────────────────
  const handleApproveCreator = async (userId) => {
    setCreatorBusy(true)
    try {
      await approveCreatorApplication(userId)
      showToast({ type: 'success', message: 'Creator approved' })
      await loadCreatorApplications()
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not approve' })
    } finally { setCreatorBusy(false) }
  }

  const handleRejectCreator = async () => {
    if (!rejectModal || !rejectReason.trim()) return
    setCreatorBusy(true)
    try {
      if (rejectModal.type === 'app') {
        await rejectCreatorApplication(rejectModal.id, rejectReason)
        await loadCreatorApplications()
      } else {
        await rejectSubmission(rejectModal.id, rejectReason)
        await loadSubmissions()
      }
      showToast({ type: 'success', message: 'Rejected with reason' })
      setRejectModal(null); setRejectReason('')
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not reject' })
    } finally { setCreatorBusy(false) }
  }

  const handleApproveSubmission = async (id) => {
    setCreatorBusy(true)
    try {
      await approveSubmission(id)
      showToast({ type: 'success', message: 'Content approved and now live' })
      await loadSubmissions()
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not approve' })
    } finally { setCreatorBusy(false) }
  }

  // ── Upload handlers ───────────────────────────────────────────────────────
  const handleCreateCollection = async (e) => {
    e.preventDefault(); setNotice(''); setError(''); setBusy(true)
    try {
      const created = await createAdminCollection({ name: collectionName, bunnyCollectionId })
      setCollections((prev) => [created, ...prev.filter((c) => c._id !== created._id)])
      setCollectionName(''); setBunnyCollectionId('')
      setNotice('Collection mapping saved.')
    } catch (err) {
      setError(err?.message || 'Could not save collection.')
    } finally { setBusy(false) }
  }

  const handleCreateNewBunnyCollection = async (e) => {
    e.preventDefault(); setNotice(''); setError(''); setBusy(true)
    try {
      const created = await createBunnyCollection(newCollectionName.trim())
      setCollections((prev) => [created, ...prev.filter((c) => c._id !== created._id)])
      setBunnyCollections((prev) => [...prev, { guid: created.bunnyCollectionId, name: created.name }])
      setNewCollectionName('')
      setCollectionMode('pick')
      setNotice(`Collection "${created.name}" created in CDN and saved.`)
    } catch (err) {
      setError(err?.message || 'Could not create collection.')
    } finally { setBusy(false) }
  }

  const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/webm', 'video/mkv']
  const ALLOWED_VIDEO_EXTS  = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']
  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024 // 2 GB

  const validateVideoFile = (f) => {
    if (!f) return 'Please choose a video file.'
    // Browsers sometimes report MKV as empty string or non-standard MIME — fall back to extension
    const ext = f.name.split('.').pop()?.toLowerCase() || ''
    const typeOk = ALLOWED_VIDEO_TYPES.includes(f.type) || ALLOWED_VIDEO_EXTS.includes(ext)
    if (!typeOk) return `Unsupported file type. Use MP4, MOV, or MKV.`
    if (f.size > MAX_FILE_SIZE) return `File is too large (${(f.size / 1024 / 1024).toFixed(0)} MB). Maximum is 2 GB.`
    return null
  }

  const handleFileChange = (f) => {
    const err = validateVideoFile(f)
    if (err) { setError(err); return }
    setError(''); setFile(f)

    // Auto-extract a poster from the first video frame if the selected content has none
    if (selectedContentId) {
      const selected = contentItems.find((c) => c._id === selectedContentId)
      if (selected && !selected.posterUrl) {
        setAutoThumbUploading(true)
        analyseVideoFrame(f).then(async (thumb) => {
          if (!thumb) return
          try {
            const thumbFile = dataUrlToFile(thumb, 'auto-poster.jpg')
            const url = await uploadToCloudinary(thumbFile, { folder: 'dhara/content/posters' })
            await updateAdminContent(selectedContentId, { posterUrl: url })
            setContentItems((prev) => prev.map((c) => c._id === selectedContentId ? { ...c, posterUrl: url } : c))
            setNotice('Auto-poster set from video frame — you can change it in the edit panel.')
          } catch {
            // non-fatal; poster can be added manually later
          }
        }).catch(() => {}).finally(() => setAutoThumbUploading(false))
      }
    }
  }

  // When a Series content item is selected, fetch its existing episodes
  const handleCategoryChange = (cat) => {
    setUploadCategory(cat)
    setSelectedContentId(''); setTitle(''); setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setSeasonNumber('1')
    setEpisodeNumber(''); setEpisodeTitle(''); setEpisodeDuration(''); setSeriesEpisodes([])
    setUploadMode('single')
    setBulkRows([{ id: bulkRowIdRef.current++, number: '', title: '', duration: '', file: null, status: 'idle', progress: 0, error: '' }])
    setError(''); setNotice('')
  }

  const handleContentSelect = async (contentId) => {
    setSelectedContentId(contentId)
    setSeasonNumber('1')
    setEpisodeNumber(''); setEpisodeTitle(''); setEpisodeDuration('')
    setSeriesEpisodes([])
    setUploadMode('single')
    setBulkRows([{ id: bulkRowIdRef.current++, number: '', title: '', duration: '', file: null, status: 'idle', progress: 0, error: '' }])
    const selected = contentItems.find((c) => c._id === contentId)
    if ((selected?.type === 'Series' || selected?.type === 'Serial Drama') && contentId) {
      setLoadingSeriesEpisodes(true)
      try {
        const full = await fetchAdminContentById(contentId)
        // Flatten episodes from all seasons, preserving which season each belongs to
        const eps = (full.seasons || [])
          .flatMap((s) => (s.episodes || []).map((ep) => ({ ...ep, seasonNumber: s.number })))
          .sort((a, b) => a.seasonNumber !== b.seasonNumber ? a.seasonNumber - b.seasonNumber : a.number - b.number)
        setSeriesEpisodes(eps)
        // Auto-suggest next episode in season 1
        const s1 = eps.filter((e) => e.seasonNumber === 1)
        const nextNum = s1.length > 0 ? Math.max(...s1.map((e) => e.number)) + 1 : 1
        setEpisodeNumber(String(nextNum))
      } catch { /* non-critical */ }
      finally { setLoadingSeriesEpisodes(false) }
    }
  }

  // ── Shelf handlers ────────────────────────────────────────────────────────
  const loadShelves = async () => {
    setShelvesLoading(true)
    try {
      const data = await listAdminShelves()
      setShelves(data)
    } catch { /* non-critical */ }
    finally { setShelvesLoading(false) }
  }

  const openCreateShelf = () => {
    setEditingShelfId(null); setShelfForm(EMPTY_SHELF)
    setShelfNotice(''); setShelfError(''); setShelfContentSearch('')
    setShowShelfModal(true)
  }

  const openEditShelf = (shelf) => {
    setEditingShelfId(shelf._id)
    setShelfForm({
      name:        shelf.name        || '',
      tagline:     shelf.tagline     || '',
      backdropUrl: shelf.backdropUrl || '',
      accentColor: shelf.accentColor || '#db2777',
      contentIds:  (shelf.contentIds || []).map((id) => String(id)),
    })
    setShelfNotice(''); setShelfError(''); setShelfContentSearch('')
    setShowShelfModal(true)
  }

  const closeShelfModal = () => { setShowShelfModal(false); setShelfError(''); setShelfNotice('') }

  const handleShelfSave = async () => {
    if (!shelfForm.name.trim()) { setShelfError('Name is required.'); return }
    setShelfBusy(true); setShelfError(''); setShelfNotice('')
    try {
      if (editingShelfId) {
        await updateAdminShelf(editingShelfId, shelfForm)
        setShelfNotice('Shelf updated.')
      } else {
        await createAdminShelf(shelfForm)
        closeShelfModal()
      }
      await loadShelves()
    } catch (err) {
      setShelfError(err?.message || 'Could not save shelf.')
    } finally { setShelfBusy(false) }
  }

  const handleShelfDelete = async (id) => {
    if (!window.confirm('Delete this shelf? It cannot be undone.')) return
    try {
      await deleteAdminShelf(id)
      await loadShelves()
      showToast({ type: 'success', message: 'Shelf deleted.' })
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not delete shelf.' })
    }
  }

  const handleShelfToggleActive = async (shelf) => {
    try {
      await updateAdminShelf(shelf._id, { isActive: !shelf.isActive })
      await loadShelves()
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not toggle shelf.' })
    }
  }

  const handleShelfDrop = async (toIdx) => {
    setDragOverShelfIdx(null)
    if (dragShelfIdx === null || dragShelfIdx === toIdx) { setDragShelfIdx(null); return }
    const previous = [...shelves]
    const reordered = [...shelves]
    const [moved] = reordered.splice(dragShelfIdx, 1)
    reordered.splice(toIdx, 0, moved)
    setShelves(reordered)
    setDragShelfIdx(null)
    try {
      await reorderAdminShelves(reordered.map((s, i) => ({ id: s._id, displayOrder: i })))
      showToast({ type: 'success', message: 'Shelf order saved.' })
    } catch (err) {
      setShelves(previous)
      showToast({ type: 'error', message: err?.message || 'Could not save shelf order.' })
    }
  }

  const handleShelfImageUpload = async (file) => {
    if (!file) return
    setShelfImgUploading(true)
    try {
      const url = await uploadToCloudinary(file, { folder: 'dhara/shelves', onProgress: () => {} })
      setShelfForm((prev) => ({ ...prev, backdropUrl: url }))
    } catch (err) {
      setShelfError(err?.message || 'Image upload failed.')
    } finally { setShelfImgUploading(false) }
  }

  const toggleShelfContent = (contentId) => {
    const id = String(contentId)
    setShelfForm((prev) => ({
      ...prev,
      contentIds: prev.contentIds.includes(id)
        ? prev.contentIds.filter((c) => c !== id)
        : [...prev.contentIds, id],
    }))
  }

  // ── Creator Revenue handlers ──────────────────────────────────────────────
  const loadCreatorRevenue = async () => {
    setRevenueLoading(true)
    setRevenueError('')
    try {
      const [earnings, payouts, platform] = await Promise.all([
        listAdminCreatorEarnings(),
        listAdminCreatorPayouts(),
        getAdminRevenue(),
      ])
      setCreatorEarnings(earnings)
      setCreatorPayouts(payouts)
      setPlatformRevenue(platform)
    } catch (err) {
      setRevenueError(err?.message || 'Could not load revenue data.')
    } finally {
      setRevenueLoading(false)
    }
  }

  const handleCalculateEarnings = async () => {
    setCalcBusy(true); setCalcResult(null); setRevenueError('')
    try {
      const res = await calculateCreatorEarnings(calcForm)
      setCalcResult(res)
      await loadCreatorRevenue()
    } catch (err) {
      setRevenueError(err?.message || 'Calculation failed.')
    } finally {
      setCalcBusy(false) }
  }

  const handleProcessPayout = async () => {
    if (!showPayoutModal) return
    setPayoutBusy(true); setRevenueError('')
    try {
      await processCreatorPayout({ creatorId: showPayoutModal.creatorId, ...payoutForm })
      showToast({ type: 'success', message: `Payout of ₹${showPayoutModal.pending.toLocaleString('en-IN')} processed` })
      setShowPayoutModal(null)
      setPayoutForm({ method: 'Bank Transfer', referenceId: '', notes: '' })
      await loadCreatorRevenue()
    } catch (err) {
      setRevenueError(err?.message || 'Payout failed.')
    } finally {
      setPayoutBusy(false) }
  }

  const handleBulkUpload = async (e) => {
    e.preventDefault()
    if (!selectedCollectionId) { setError('Please select a mapped collection.'); return }
    const validRows = bulkRows.filter((r) => r.number && r.file)
    if (validRows.length === 0) { setError('Add at least one row with an episode number and video file.'); return }
    const badDuration = validRows.find((r) => r.duration && !isValidDuration(r.duration))
    if (badDuration) {
      setError(`Ep ${badDuration.number}: invalid duration "${badDuration.duration}". Use "42m", "1h 20m", or "1:20".`)
      return
    }

    // ── Duplicate guardrails ──────────────────────────────────────────────
    const seenKeys = new Set()
    for (const row of validRows) {
      const key = `${row.season || 1}-${row.number}`
      if (seenKeys.has(key)) {
        setError(`Duplicate in batch: S${row.season || 1}E${row.number} appears more than once. Remove the duplicate row.`)
        return
      }
      seenKeys.add(key)
    }
    if (selectedContentId && seriesEpisodes.length > 0) {
      const dupRow = validRows.find((row) =>
        seriesEpisodes.some((ep) => ep.seasonNumber === Number(row.season || 1) && ep.number === Number(row.number))
      )
      if (dupRow) {
        setError(`S${dupRow.season || 1}E${dupRow.number} is already uploaded for this series. Remove it from the batch or use the Map tab to replace the existing video.`)
        return
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    setBulkBusy(true); setError(''); setNotice('')
    let allOk = true
    for (const row of validRows) {
      const fileErr = validateVideoFile(row.file)
      if (fileErr) {
        setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: 'error', error: fileErr } : r))
        allOk = false; continue
      }
      setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: 'uploading', progress: 0, error: '' } : r))
      try {
        const job = await createUploadJob({
          title:           row.title.trim() || `Episode ${row.number}`,
          collectionId:    selectedCollectionId,
          contentId:       selectedContentId || null,
          seasonNumber:    Number(row.season  || 1),
          episodeNumber:   Number(row.number),
          episodeTitle:    row.title.trim(),
          episodeDuration: row.duration.trim(),
        })
        await uploadJobFile(job._id, row.file, {
          onProgress: (p) => setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, progress: p } : r)),
        })
        setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: 'done', progress: 100 } : r))
      } catch (err) {
        setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: 'error', error: err?.message || 'Upload failed' } : r))
        allOk = false
      }
    }
    setBulkBusy(false)
    if (allOk) {
      setNotice(`Queued ${validRows.length} episode upload${validRows.length !== 1 ? 's' : ''} — processing asynchronously.`)
      setBulkRows([{ id: bulkRowIdRef.current++, number: '', title: '', duration: '', file: null, status: 'idle', progress: 0, error: '' }])
      setUploadMode('single')
      await loadData()
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    const fileErr = validateVideoFile(file)
    if (fileErr) return setError(fileErr)
    if (!selectedCollectionId) return setError('Please select a mapped collection.')

    const isSeries = uploadCategory === 'Series' || uploadCategory === 'Serial Drama'
    if (isSeries && !episodeNumber) return setError('Please enter an episode number for this series.')
    if (isSeries && episodeDuration && !isValidDuration(episodeDuration))
      return setError(`Invalid episode duration "${episodeDuration}". Use "42m", "1h 20m", or "1:20".`)

    // ── Duplicate guardrails ──────────────────────────────────────────────
    if (isSeries && selectedContentId && episodeNumber) {
      const dupEp = seriesEpisodes.find(
        (ep) => ep.seasonNumber === Number(seasonNumber) && ep.number === Number(episodeNumber)
      )
      if (dupEp) {
        setError(`S${seasonNumber}E${episodeNumber} is already uploaded for this series. Choose a different episode number, or use the Map tab to replace the existing video.`)
        return
      }
    }
    if (!isSeries && selectedContentId) {
      const sel = contentItems.find((c) => c._id === selectedContentId)
      if (sel?.bunnyVideoId) {
        if (!window.confirm(`"${sel.title}" already has a video linked.\n\nQueue another upload anyway? Use the Map tab if you want to replace the existing video instead.`)) return
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    setNotice(''); setError(''); setBusy(true)
    const fileToUpload = file
    try {
      const job = await createUploadJob({
        title:           isSeries && episodeTitle.trim() ? episodeTitle.trim() : title,
        collectionId:    selectedCollectionId,
        contentId:       selectedContentId || null,
        seasonNumber:    isSeries ? Number(seasonNumber)  : null,
        episodeNumber:   isSeries ? Number(episodeNumber) : null,
        episodeTitle:    isSeries ? episodeTitle.trim()   : '',
        episodeDuration: isSeries ? episodeDuration.trim() : '',
      })
      // Reset the form as soon as the job is queued so admin can start the next upload
      setTitle(''); setSelectedContentId(''); setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSeasonNumber('1')
      setEpisodeNumber(''); setEpisodeTitle(''); setEpisodeDuration(''); setSeriesEpisodes([])
      setNotice('Sending to server… 0%')
      setUploadProgress(0)
      await uploadJobFile(job._id, fileToUpload, {
        onProgress: (p) => {
          setUploadProgress(p)
          setNotice(`Sending to server… ${p}%`)
        },
      })
      setUploadProgress(0)
      setNotice('Upload accepted — video is processing asynchronously.')
      await loadData()
    } catch (err) {
      setUploadProgress(0)
      setError(err?.message || 'Upload failed.')
    } finally { setBusy(false) }
  }

  const handleImportFromCdn = async () => {
    setNotice(''); setError(''); setBusy(true)
    try {
      const result = await importFromCdn()
      setNotice(result.imported > 0
        ? `Imported ${result.imported} new video${result.imported !== 1 ? 's' : ''} from CDN.`
        : 'No new videos found — all CDN videos are already in the library.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not import from CDN.')
    } finally { setBusy(false) }
  }

  const handleSyncDeletions = async () => {
    setNotice(''); setError(''); setBusy(true)
    try {
      const result = await syncCdnDeletions()
      const parts = []
      if (result.rootDeleted > 0) parts.push(`${result.rootDeleted} item${result.rootDeleted !== 1 ? 's' : ''} removed`)
      if (result.showsDeleted > 0) parts.push(`${result.showsDeleted} show${result.showsDeleted !== 1 ? 's' : ''} removed`)
      if (result.episodesCleared > 0) parts.push(`${result.episodesCleared} episode link${result.episodesCleared !== 1 ? 's' : ''} cleared`)
      setNotice(parts.length > 0
        ? `CDN sync: ${parts.join(', ')} (${result.activeBunnyVideos} active videos on Bunny).`
        : `CDN sync complete — no stale videos found (${result.activeBunnyVideos} active videos on Bunny).`)
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not sync CDN deletions.')
    } finally { setBusy(false) }
  }

  const handleMapExisting = async (e) => {
    e.preventDefault()
    if (!mapContentId || !mapVideoId) { setError('Select both a content item and a stream video.'); return }
    const mapSelectedType = contentItems.find((c) => c._id === mapContentId)?.type
    const mapIsEpisodic = mapSelectedType === 'Series' || mapSelectedType === 'Serial Drama'
    if (mapIsEpisodic && !mapEpisodeNumber) { setError('Enter an episode number for this series.'); return }
    setNotice(''); setError(''); setBusy(true)
    try {
      const payload = { contentId: mapContentId, bunnyVideoId: mapVideoId }
      if (mapIsEpisodic) {
        payload.seasonNumber  = Number(mapSeasonNumber  || 1)
        payload.episodeNumber = Number(mapEpisodeNumber)
      }
      const result = await mapExistingBunnyVideo(payload)
      setNotice(result.message || 'Stream video mapped successfully.')
      setMapEpisodeNumber('')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not map stream video.')
    } finally { setBusy(false) }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (sessionLoading) return <main className={styles.state}>Loading admin studio...</main>

  if (!adminAllowed) {
    return (
      <main className={styles.state}>
        <div className={styles.gate}>
          <ShieldAlert size={24} />
          <p>{sessionError || 'Admin access required.'}</p>
        </div>
      </main>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className={styles.page}>

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{toast.message}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* Live mode confirmation overlay */}
      {showLiveConfirm && (
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && setShowLiveConfirm(false)}>
          <div className={styles.modalPanel} style={{ maxWidth: 440 }} role="dialog" aria-modal="true">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle} style={{ color: '#f87171' }}>
                <AlertTriangle size={16} />
                Switch to Live Mode
              </h2>
              <button className={styles.modalClose} onClick={() => setShowLiveConfirm(false)}><X size={16} /></button>
            </div>
            <div style={{ padding: '20px 24px 24px' }}>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
                Live mode processes <strong style={{ color: 'var(--color-text)' }}>real payments</strong> from real users.
                Make sure your provider credentials, webhook endpoint, and plan amounts are production-ready before switching.
              </p>
              <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 8 }}>
                Type <code style={{ color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '1px 6px', borderRadius: 4 }}>LIVE</code> to confirm
              </label>
              <input
                className={styles.input}
                value={liveConfirmText}
                onChange={(e) => setLiveConfirmText(e.target.value)}
                placeholder="LIVE"
                autoFocus
              />
              <div className={styles.modalFooter} style={{ marginTop: 20 }}>
                <button className={styles.ghostBtn} onClick={() => { setShowLiveConfirm(false); setLiveConfirmText('') }}>Cancel</button>
                <button
                  className={styles.primaryBtn}
                  style={{ background: liveConfirmText === 'LIVE' ? '#dc2626' : undefined }}
                  disabled={liveConfirmText !== 'LIVE' || paymentBusy}
                  onClick={handleConfirmLive}
                >
                  Activate Live Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Admin Studio</h1>
          <p className={styles.titleSub}>
            {activeTab === 'content'  && 'Manage the content library'}
            {activeTab === 'uploads'  && 'Upload and map video files'}
            {activeTab === 'payments' && 'Configure payment infrastructure'}
            {activeTab === 'creators' && 'Review creator applications, content submissions and reels'}
            {activeTab === 'revenue'  && 'Calculate monthly earnings and process creator payouts'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.refreshBtn}
            onClick={async () => {
              setRefreshCountdown(5)
              setIsRefreshing(true)
              try { await loadData() } finally { setIsRefreshing(false) }
            }}
            disabled={isRefreshing}
          >
            <RefreshCw size={13} className={isRefreshing ? styles.refreshIconSpin : ''} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
            {!isRefreshing && activeTab === 'uploads' && (
              <span className={styles.refreshCountdownBadge}>{refreshCountdown}s</span>
            )}
          </button>
          {activeTab === 'uploads' && (
            <>
              <button className={styles.refreshBtn} onClick={handleSyncDeletions} disabled={busy}>
                <RefreshCw size={13} /> Sync Deletions
              </button>
              <button className={styles.importBtn} onClick={handleImportFromCdn} disabled={busy}>
                <UploadCloud size={13} /> Import from CDN
              </button>
            </>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <nav className={styles.tabBar}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(id); setError(''); setNotice('') }}
          >
            <Icon size={14} />
            {label}
            {id === 'payments' && paymentConfig?.mode === 'live' && (
              <span className={styles.tabLivePip} title="Live mode active" />
            )}
          </button>
        ))}
      </nav>

      {(notice || error) && (
        <div className={`${styles.message} ${error ? styles.error : styles.notice}`}>
          {error || notice}
          {!error && uploadProgress > 0 && (
            <div className={styles.uploadProgressTrack}>
              <div className={styles.uploadProgressFill} style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* ── CONTENT TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'content' && (
        <section className={styles.jobsCard}>
          <div className={styles.libraryHeader}>
            <h2 className={styles.cardTitle}><Library size={16} /> Content Library</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className={styles.librarySearch}
                placeholder="Search title or type…"
                value={contentSearch}
                onChange={(e) => setContentSearch(e.target.value)}
              />
              <button
                className={styles.primaryBtn}
                style={{ padding: '7px 14px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
                onClick={openCreateModal}
              >
                <Plus size={13} /> New Content
              </button>
            </div>
          </div>
          <div className={styles.libraryList}>
            {filteredContent.length === 0 && <p className={styles.empty}>No content found.</p>}
            {filteredContent.map((item) => (
              <div key={item._id} className={styles.libraryRow}>
                <div className={styles.libraryLeft}>
                  <p className={styles.libraryTitle}>{item.title}</p>
                  <p className={styles.libraryMeta}>
                    {item.type}
                    {item.releaseYear ? ` · ${item.releaseYear}` : ''}
                    {item.genre?.length ? ` · ${item.genre.join(', ')}` : ''}
                    {processingContentIds.has(item._id) ? ' · Transcoding…' : !item.bunnyVideoId ? ' · No video' : ''}
                  </p>
                  {/* Engagement stats — only shown for published content with activity */}
                  {item.isPublished && (item.viewCount > 0 || item.likeCount > 0 || item.communityRatingCount > 0) && (
                    <div className={styles.contentEngRow}>
                      {item.viewCount > 0 && (
                        <span className={styles.contentEngStat}>
                          <Eye size={10} />
                          {item.viewCount >= 1000 ? `${(item.viewCount/1000).toFixed(1)}k` : item.viewCount} views
                        </span>
                      )}
                      {item.likeCount > 0 && (
                        <span className={styles.contentEngStat}>
                          <TrendingUp size={10} />
                          {item.likeCount} likes
                        </span>
                      )}
                      {item.communityRatingCount > 0 && (
                        <span className={styles.contentEngStat} style={{ color: '#f472b6' }}>
                          ★ {item.communityRating?.toFixed(1)} <span style={{ opacity: 0.6 }}>({item.communityRatingCount})</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className={styles.libraryActions}>
                  {(() => {
                    const isProcessing = processingContentIds.has(item._id)
                    const hasVideo = Boolean(item.bunnyVideoId)
                    const canPublish = hasVideo && !isProcessing
                    return (
                      <button
                        className={`${styles.proToggleBtn} ${item.isPublished ? styles.proToggleBtnOn : ''}`}
                        onClick={() => handleTogglePublish(item)}
                        disabled={togglingPublish === item._id || (!item.isPublished && !canPublish)}
                        title={
                          isProcessing ? 'Video is still transcoding — wait for it to finish'
                          : !hasVideo ? 'No video uploaded yet'
                          : item.isPublished ? 'Click to unpublish'
                          : 'Click to publish'
                        }
                      >
                        {isProcessing ? <RefreshCw size={11} className={styles.refreshIconSpinning} /> : <Eye size={11} />}
                        {isProcessing ? 'Processing…' : item.isPublished ? 'Unpublish' : 'Publish'}
                      </button>
                    )
                  })()}
                  <button
                    className={`${styles.proToggleBtn} ${item.isPremium ? styles.proToggleBtnOn : ''}`}
                    onClick={() => handleTogglePremium(item)}
                    disabled={togglingPremium === item._id}
                    title={item.isPremium ? 'Click to make Free' : 'Click to make Premium'}
                    aria-label={item.isPremium ? 'Mark as free' : 'Mark as premium'}
                  >
                    <Crown size={11} />
                    {item.isPremium ? 'Free' : 'Premium'}
                  </button>
                  <button
                    className={styles.editBtn}
                    onClick={(e) => { e.currentTarget.blur(); openEditModal(item) }}
                    disabled={editBusy && editingId === item._id}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    className={`${styles.deleteBtn} ${confirmDeleteId === item._id ? styles.deleteBtnConfirm : ''}`}
                    onClick={() => handleDeleteContent(item)}
                    onBlur={() => { if (confirmDeleteId === item._id) setConfirmDeleteId(null) }}
                    title="Delete content"
                  >
                    <Trash2 size={12} />
                    {confirmDeleteId === item._id ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── UPLOADS TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'uploads' && (
        <>
          <section className={styles.grid}>
            <article className={styles.card}>
              <h2 className={styles.cardTitle}><FolderPlus size={16} /> Collection Mapping</h2>

              {/* mode toggle */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button
                  type="button"
                  className={collectionMode === 'pick' ? styles.primaryBtn : styles.secondaryBtn}
                  onClick={() => setCollectionMode('pick')}
                  style={{ flex: 1, padding: '0.4rem' }}
                >
                  Pick Existing
                </button>
                <button
                  type="button"
                  className={collectionMode === 'create' ? styles.primaryBtn : styles.secondaryBtn}
                  onClick={() => setCollectionMode('create')}
                  style={{ flex: 1, padding: '0.4rem' }}
                >
                  + Create New
                </button>
              </div>

              {collectionMode === 'pick' ? (
                <form className={styles.form} onSubmit={handleCreateCollection}>
                  <label className={styles.label}>
                    Dhara Collection Name
                    <input className={styles.input} value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="Bengali Classics" required />
                  </label>
                  <label className={styles.label}>
                    CDN Collection
                    <select
                      className={styles.select}
                      value={bunnyCollectionId}
                      onChange={(e) => {
                        setBunnyCollectionId(e.target.value)
                        const picked = bunnyCollections.find((c) => c.guid === e.target.value)
                        if (picked && !collectionName) setCollectionName(picked.name)
                      }}
                      required
                    >
                      <option value="">Select CDN collection</option>
                      {bunnyCollections.map((c) => (
                        <option key={c.guid} value={c.guid}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className={styles.primaryBtn} type="submit" disabled={busy}>Save Mapping</button>
                </form>
              ) : (
                <form className={styles.form} onSubmit={handleCreateNewBunnyCollection}>
                  <label className={styles.label}>
                    New Collection Name
                    <input
                      className={styles.input}
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      placeholder="e.g. Bengali Classics"
                      required
                    />
                  </label>
                  <p style={{ fontSize: '0.75rem', color: '#888', margin: '-0.5rem 0 0.5rem' }}>
                    This will create the collection in the CDN and save the mapping.
                  </p>
                  <button className={styles.primaryBtn} type="submit" disabled={busy || !newCollectionName.trim()}>
                    {busy ? 'Creating…' : 'Create Collection'}
                  </button>
                </form>
              )}
            </article>

            <article className={styles.card}>
              <h2 className={styles.cardTitle}><UploadCloud size={16} /> Upload Video</h2>
              <form className={styles.form} onSubmit={handleUpload}>

                {/* ── Content type picker ── */}
                <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', marginBottom: '0.5rem' }}>
                  STEP 1 — CONTENT TYPE
                </p>
                <div className={styles.contentTypeTabs}>
                  {[
                    { value: 'Film',         label: 'Movies' },
                    { value: 'Series',       label: 'Series' },
                    { value: 'Serial Drama', label: 'ধারাবাহিক' },
                    { value: 'Documentary',  label: 'Originals' },
                    { value: 'Live',         label: 'Live' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`${styles.contentTypeTab} ${uploadCategory === value ? styles.contentTypeTabActive : ''}`}
                      onClick={() => handleCategoryChange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', margin: '1rem 0 0.5rem' }}>
                  STEP 2 — NAME & ORGANISE
                </p>
                <label className={styles.label}>
                  {uploadCategory === 'Series' || uploadCategory === 'Serial Drama' ? 'Episode Title' : 'Title'}
                  <input
                    className={styles.input}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      uploadCategory === 'Film'         ? 'e.g. Haripada Bandwala' :
                      uploadCategory === 'Series'       ? 'e.g. Episode title' :
                      uploadCategory === 'Serial Drama' ? 'e.g. পর্বের নাম (যেমন: মায়ার জঞ্জাল)' :
                      uploadCategory === 'Live'         ? 'e.g. Live channel title' :
                                                          'e.g. Documentary title'
                    }
                    required
                  />
                </label>
                <label className={styles.label}>
                  Collection
                  <select className={styles.select} value={selectedCollectionId} onChange={(e) => setSelectedCollectionId(e.target.value)} required>
                    <option value="">Select collection</option>
                    {collections.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </label>

                <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', margin: '1rem 0 0.5rem' }}>
                  STEP 3 — LINK TO CONTENT (OPTIONAL)
                </p>
                <label className={styles.label}>
                  {uploadCategory === 'Series' || uploadCategory === 'Serial Drama' ? 'Series / Show' : 'Content Item'}
                  <select className={styles.select} value={selectedContentId} onChange={(e) => handleContentSelect(e.target.value)}>
                    <option value="">Upload without linking (map later)</option>
                    {contentItems
                      .filter((c) => c.type === uploadCategory)
                      .map((item) => (
                        <option key={item._id} value={item._id}>{item.title}</option>
                      ))}
                  </select>
                  {!selectedContentId && (
                    <span style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.3rem', display: 'block' }}>
                      Video uploads to CDN but won't appear in the app until mapped.
                    </span>
                  )}
                </label>

                {/* ── Episode fields — shown for Series and Serial Drama ── */}
                {(uploadCategory === 'Series' || uploadCategory === 'Serial Drama') && (
                  <div className={styles.episodeUploadBlock}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <p className={styles.episodeUploadTitle}>
                        <Film size={12} /> Episodes
                      </p>
                      <div className={styles.uploadModeToggle}>
                        <button
                          type="button"
                          className={uploadMode === 'single' ? styles.modePillActive : styles.modePillInactive}
                          onClick={() => setUploadMode('single')}
                        >
                          Single
                        </button>
                        <button
                          type="button"
                          className={uploadMode === 'bulk' ? styles.modePillActive : styles.modePillInactive}
                          onClick={() => setUploadMode('bulk')}
                        >
                          Bulk Queue
                        </button>
                      </div>
                    </div>

                    {loadingSeriesEpisodes && (
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading existing episodes…</p>
                    )}

                    {/* Existing episodes summary pills */}
                    {seriesEpisodes.length > 0 && uploadMode === 'single' && (
                      <div className={styles.existingEpisodes}>
                        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                          Already uploaded: {seriesEpisodes.map((ep) => `E${ep.number}`).join(', ')}
                        </p>
                        <div className={styles.epPills}>
                          {seriesEpisodes.map((ep) => (
                            <button
                              key={`${ep.seasonNumber}-${ep.number}`}
                              type="button"
                              className={`${styles.epPill} ${Number(episodeNumber) === ep.number && Number(seasonNumber) === ep.seasonNumber ? styles.epPillActive : ''}`}
                              onClick={() => {
                                setSeasonNumber(String(ep.seasonNumber || 1))
                                setEpisodeNumber(String(ep.number))
                                setEpisodeTitle(ep.title || '')
                                setEpisodeDuration(ep.duration || '')
                              }}
                            >
                              S{ep.seasonNumber}E{ep.number}
                              {ep.bunnyVideoId ? ' ✓' : ' (no video)'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Single episode fields */}
                    {uploadMode === 'single' && (
                      <>
                        <div className={styles.episodeFieldGrid}>
                          <label className={styles.label}>
                            Season #
                            <input
                              className={styles.input}
                              type="number"
                              min="1"
                              value={seasonNumber}
                              onChange={(e) => setSeasonNumber(e.target.value)}
                              placeholder="1"
                            />
                          </label>
                          <label className={styles.label}>
                            Ep #
                            <input
                              className={styles.input}
                              type="number"
                              min="1"
                              value={episodeNumber}
                              onChange={(e) => setEpisodeNumber(e.target.value)}
                              placeholder="1"
                              required
                            />
                          </label>
                          <label className={styles.label}>
                            Episode Title
                            <input
                              className={styles.input}
                              value={episodeTitle}
                              onChange={(e) => setEpisodeTitle(e.target.value)}
                              placeholder={`Episode ${episodeNumber || 'N'} title`}
                            />
                          </label>
                          <label className={styles.label}>
                            Duration
                            <input
                              className={`${styles.input} ${episodeDuration && !isValidDuration(episodeDuration) ? styles.inputError : ''}`}
                              value={episodeDuration}
                              onChange={(e) => setEpisodeDuration(e.target.value)}
                              placeholder="e.g. 42m"
                              title="Format: 42m · 1h · 1h 20m · 1:20"
                            />
                            {episodeDuration && !isValidDuration(episodeDuration) && (
                              <span style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>
                                Use: 42m · 2h · 1h 20m · 1:20
                              </span>
                            )}
                          </label>
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                          The video will link to Episode {episodeNumber || 'N'} once processed.
                        </p>
                      </>
                    )}

                    {/* Bulk upload queue */}
                    {uploadMode === 'bulk' && (
                      <div className={styles.bulkTable}>
                        <div className={styles.bulkHeaderRow}>
                          <span>Season</span>
                          <span>Ep #</span>
                          <span>Title</span>
                          <span>Duration</span>
                          <span>File</span>
                          <span />
                        </div>
                        {bulkRows.map((row) => (
                          <div key={row.id} className={`${styles.bulkRow} ${row.status === 'done' ? styles.bulkRowDone : row.status === 'error' ? styles.bulkRowError : row.status === 'uploading' ? styles.bulkRowUploading : ''}`}>
                            <input
                              className={styles.input}
                              type="number"
                              min="1"
                              value={row.season ?? 1}
                              placeholder="1"
                              disabled={bulkBusy}
                              onChange={(e) => setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, season: e.target.value } : r))}
                            />
                            <input
                              className={styles.input}
                              type="number"
                              min="1"
                              value={row.number}
                              placeholder="1"
                              disabled={bulkBusy}
                              onChange={(e) => setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, number: e.target.value } : r))}
                            />
                            <input
                              className={styles.input}
                              value={row.title}
                              placeholder="Episode title"
                              disabled={bulkBusy}
                              onChange={(e) => setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, title: e.target.value } : r))}
                            />
                            <input
                              className={`${styles.input} ${row.duration && !isValidDuration(row.duration) ? styles.inputError : ''}`}
                              value={row.duration}
                              placeholder="42m"
                              title="Format: 42m · 1h · 1h 20m · 1:20"
                              disabled={bulkBusy}
                              onChange={(e) => setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, duration: e.target.value } : r))}
                            />
                            <label className={styles.bulkFileBtn}>
                              {row.status === 'uploading' ? `⟳ ${row.progress}%`
                                : row.status === 'done'    ? '✓ Done'
                                : row.file                 ? row.file.name.slice(0, 20)
                                :                            'Choose file'}
                              <input
                                type="file"
                                accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska"
                                style={{ display: 'none' }}
                                disabled={bulkBusy || row.status === 'done'}
                                onChange={(e) => {
                                  const f = e.target.files?.[0] || null
                                  setBulkRows((prev) => prev.map((r) => r.id === row.id ? { ...r, file: f, status: 'idle', error: '' } : r))
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className={styles.epDeleteBtn}
                              disabled={bulkBusy}
                              onClick={() => setBulkRows((prev) => prev.filter((r) => r.id !== row.id))}
                              aria-label="Remove row"
                            >
                              <X size={12} />
                            </button>
                            {row.error && (
                              <p className={styles.bulkRowErrMsg}>{row.error}</p>
                            )}
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            disabled={bulkBusy}
                            onClick={() => {
                              const nextNum = bulkRows.reduce((max, r) => Math.max(max, Number(r.number) || 0), 0) + 1
                              setBulkRows((prev) => [...prev, { id: bulkRowIdRef.current++, number: String(nextNum), title: '', duration: '', file: null, status: 'idle', progress: 0, error: '' }])
                            }}
                            style={{ fontSize: 12, padding: '5px 12px' }}
                          >
                            + Add Row
                          </button>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            disabled={bulkBusy}
                            onClick={handleBulkUpload}
                            style={{ fontSize: 12, padding: '5px 16px' }}
                          >
                            {bulkBusy ? 'Uploading…' : `Upload All (${bulkRows.filter((r) => r.number && r.file && r.status !== 'done').length})`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {uploadMode === 'single' && <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', margin: '1rem 0 0.5rem' }}>
                  STEP 4 — UPLOAD FILE
                </p>}
                <div className={styles.label} style={uploadMode === 'bulk' ? { display: 'none' } : {}}>
                  <div
                    className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFileChange(f) }}
                  >
                    <Film size={22} className={styles.dropZoneIcon} />
                    {file
                      ? <><span className={styles.dropZoneFile}>{file.name}</span><span className={styles.dropZoneHint}>{(file.size / 1024 / 1024).toFixed(1)} MB</span></>
                      : <><span className={styles.dropZoneText}>Drop video file here</span><span className={styles.dropZoneHint}>or click to browse · MP4, MOV, MKV · max 2 GB</span></>
                    }
                    <input ref={fileInputRef} className={styles.fileInput} type="file" accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska" onChange={(e) => handleFileChange(e.target.files?.[0] || null)} required />
                  </div>
                </div>

                {autoThumbUploading && (
                  <p style={{ fontSize: 11, color: 'var(--color-accent)', margin: '0 0 8px' }}>
                    ⟳ Extracting poster from video frame…
                  </p>
                )}

                {uploadMode === 'single' && (
                  <button className={styles.primaryBtn} type="submit" disabled={busy || !selectedCollection}>
                    {busy ? 'Uploading…' : 'Upload Video'}
                  </button>
                )}
              </form>
            </article>
          </section>

          <section className={styles.jobsCard}>
            <h2 className={styles.cardTitle}><Link2 size={16} /> Map Existing Video</h2>
            <p style={{ fontSize: '0.78rem', color: '#888', margin: '-0.25rem 0 1.25rem' }}>
              Use this when a video already exists in the CDN but hasn't been linked to a Dhara content item yet.
            </p>
            <form className={styles.form} onSubmit={handleMapExisting}>

              <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', marginBottom: '0.5rem' }}>
                STEP 1 — FIND THE CDN VIDEO
              </p>
              <label className={styles.label}>
                Collection
                <select className={styles.select} value={mapCollectionId} onChange={(e) => { setMapCollectionId(e.target.value); setMapVideoId(''); void loadBunnyVideos(e.target.value) }}>
                  <option value="">Select collection</option>
                  {bunnyCollections.map((c) => <option key={c.guid} value={c.guid}>{c.name} ({c.videoCount} videos)</option>)}
                </select>
              </label>
              <label className={styles.label}>
                Video
                <select className={styles.select} value={mapVideoId} onChange={(e) => setMapVideoId(e.target.value)} disabled={!mapCollectionId}>
                  <option value="">{mapCollectionId ? 'Select video' : 'Select a collection first'}</option>
                  {bunnyVideos.map((v) => <option key={v.guid} value={v.guid}>{v.title} ({Math.round((v.length || 0) / 60)} min)</option>)}
                </select>
                {mapVideoError && <span style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.3rem', display: 'block' }}>{mapVideoError}</span>}
              </label>

              <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', margin: '1rem 0 0.5rem' }}>
                STEP 2 — CHOOSE THE DHARA CONTENT TO LINK IT TO
              </p>
              <label className={styles.label}>
                Content Item
                <select className={styles.select} value={mapContentId} onChange={(e) => { setMapContentId(e.target.value); setMapEpisodeNumber(''); setMapSeasonNumber('1') }}>
                  <option value="">Select content</option>
                  {contentItems.map((item) => <option key={item._id} value={item._id}>{item.title} ({item.type})</option>)}
                </select>
              </label>

              {/* Season + episode fields for series */}
              {mapContentId && ['Series', 'Serial Drama'].includes(contentItems.find((c) => c._id === mapContentId)?.type) && (
                <div style={{ display: 'grid', gridTemplateColumns: '80px 80px', gap: 8 }}>
                  <label className={styles.label}>
                    Season #
                    <input
                      className={styles.input}
                      type="number"
                      min="1"
                      value={mapSeasonNumber}
                      onChange={(e) => setMapSeasonNumber(e.target.value)}
                      placeholder="1"
                    />
                  </label>
                  <label className={styles.label}>
                    Ep #
                    <input
                      className={styles.input}
                      type="number"
                      min="1"
                      value={mapEpisodeNumber}
                      onChange={(e) => setMapEpisodeNumber(e.target.value)}
                      placeholder="1"
                      required
                    />
                  </label>
                </div>
              )}

              <button className={styles.primaryBtn} type="submit" disabled={busy || !mapVideoId || !mapContentId}>
                Link Video to Content
              </button>
            </form>
          </section>

          <section className={styles.jobsCard}>
            <div className={styles.uploadQueueHeader}>
              <h2 className={styles.cardTitle}>Upload Queue</h2>
              <span className={styles.liveIndicator}>
                <span className={styles.livePulseDot} />
                Live
              </span>
            </div>
            <div className={styles.jobsList}>
              {jobs.length === 0 && <p className={styles.empty}>No uploads yet.</p>}
              {jobs.map((job) => (
                <article key={job._id} className={styles.jobRow}>
                  <div className={styles.jobMain}>
                    <p className={styles.jobTitle}>
                      {job.episodeNumber
                        ? <>E{job.episodeNumber}{job.episodeTitle ? ` — ${job.episodeTitle}` : ''}</>
                        : job.title
                      }
                    </p>
                    <p className={styles.jobMeta}>
                      {job.collectionName || job.collectionId?.name || 'Unknown'}
                      {job.episodeDuration ? ` · ${job.episodeDuration}` : ''}
                      {job.bunnyVideoId ? ` · ${job.bunnyVideoId}` : ''}
                    </p>
                  </div>
                  <div className={styles.jobSide}>
                    <span className={`${styles.statusBadge} ${statusClass[job.status] || ''}`}>{job.status}</span>
                    <span className={styles.progress}>{job.progress || 0}%</span>
                  </div>
                  <p className={styles.jobNote}>{job.error || job.note || 'Pending update...'}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ── SHELVES TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'shelves' && (
        <section className={styles.jobsCard}>

          {/* Shelf create / edit modal */}
          {showShelfModal && (
            <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && closeShelfModal()}>
              <div className={styles.modalPanel} style={{ maxWidth: 680 }} role="dialog" aria-modal="true">
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}><Layers size={14} /> {editingShelfId ? 'Edit Shelf' : 'New Shelf'}</h2>
                  <button className={styles.modalClose} onClick={closeShelfModal}><X size={16} /></button>
                </div>
                {shelfNotice && <p className={`${styles.message} ${styles.notice}`}>{shelfNotice}</p>}
                {shelfError  && <p className={`${styles.message} ${styles.error}`}>{shelfError}</p>}
                <div className={styles.modalForm} style={{ overflowY: 'auto', maxHeight: '70vh', padding: '20px 24px' }}>
                  <div className={styles.modalGrid}>
                    <label className={`${styles.label} ${styles.spanFull}`}>
                      Shelf Name *
                      <input className={styles.input} value={shelfForm.name} onChange={(e) => setShelfForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Bengali Noir" autoFocus />
                    </label>
                    <label className={`${styles.label} ${styles.spanFull}`}>
                      Tagline <span className={styles.labelHint}>(short descriptor)</span>
                      <input className={styles.input} value={shelfForm.tagline} onChange={(e) => setShelfForm((p) => ({ ...p, tagline: e.target.value }))} placeholder="Dark, slow-burn thrillers" />
                    </label>

                    {/* Backdrop image */}
                    <div className={`${styles.label} ${styles.spanFull}`}>
                      Backdrop Image
                      <div className={styles.shelfBackdropPreview} style={{ backgroundImage: shelfForm.backdropUrl ? `url(${shelfForm.backdropUrl})` : undefined, borderColor: shelfForm.accentColor + '44' }}>
                        {!shelfForm.backdropUrl && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No backdrop — gradient will be used</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <label className={styles.imageUploadBtn}>
                          {shelfImgUploading ? 'Uploading…' : 'Upload Backdrop'}
                          <input type="file" accept="image/*" style={{ display: 'none' }} disabled={shelfImgUploading}
                            onChange={(e) => handleShelfImageUpload(e.target.files?.[0])} />
                        </label>
                        <input className={styles.input} value={shelfForm.backdropUrl} onChange={(e) => setShelfForm((p) => ({ ...p, backdropUrl: e.target.value }))} placeholder="Or paste URL…" style={{ flex: 1 }} />
                      </div>
                    </div>

                    {/* Accent color swatches */}
                    <div className={`${styles.label} ${styles.spanFull}`}>
                      Accent Colour
                      <div className={styles.shelfSwatches}>
                        {SHELF_ACCENT_COLORS.map(({ hex, name }) => (
                          <button
                            key={hex}
                            type="button"
                            className={`${styles.shelfSwatch} ${shelfForm.accentColor === hex ? styles.shelfSwatchActive : ''}`}
                            style={{ background: hex }}
                            onClick={() => setShelfForm((p) => ({ ...p, accentColor: hex }))}
                            title={name}
                            aria-label={name}
                          />
                        ))}
                        <input
                          type="color"
                          value={shelfForm.accentColor}
                          onChange={(e) => setShelfForm((p) => ({ ...p, accentColor: e.target.value }))}
                          className={styles.shelfColorInput}
                          title="Custom colour"
                        />
                      </div>
                    </div>

                    {/* Content picker */}
                    <div className={`${styles.label} ${styles.spanFull}`}>
                      Content <span className={styles.labelHint}>({shelfForm.contentIds.length} selected)</span>

                      {/* Selected chips */}
                      {shelfForm.contentIds.length > 0 && (
                        <div className={styles.shelfSelectedChips}>
                          {shelfForm.contentIds.map((id) => {
                            const it = contentItems.find((c) => String(c._id) === id)
                            if (!it) return null
                            return (
                              <span key={id} className={styles.shelfSelectedChip} style={{ borderColor: shelfForm.accentColor + '66' }}>
                                {it.posterUrl && (
                                  <img src={cloudinaryTransform(it.posterUrl, 'w_28,h_40,c_fill,f_auto,q_auto')} alt="" className={styles.shelfChipThumb} />
                                )}
                                <span className={styles.shelfChipLabel}>{it.title}</span>
                                <button type="button" className={styles.shelfChipRemove} onClick={() => toggleShelfContent(id)}>×</button>
                              </span>
                            )
                          })}
                        </div>
                      )}

                      <input
                        className={styles.input}
                        value={shelfContentSearch}
                        onChange={(e) => setShelfContentSearch(e.target.value)}
                        placeholder="Search titles to add…"
                        style={{ marginBottom: 8 }}
                      />
                      <div className={styles.shelfContentPicker}>
                        {contentItems
                          .filter((item) => !shelfContentSearch.trim() || item.title.toLowerCase().includes(shelfContentSearch.toLowerCase()))
                          .map((item) => {
                            const selected = shelfForm.contentIds.includes(String(item._id))
                            const thumb = item.posterUrl
                              ? cloudinaryTransform(item.posterUrl, 'w_40,h_60,c_fill,f_auto,q_auto')
                              : null
                            return (
                              <label
                                key={item._id}
                                className={`${styles.shelfContentRow} ${selected ? styles.shelfContentRowSelected : ''}`}
                                style={selected ? { borderColor: shelfForm.accentColor + '55' } : {}}
                              >
                                <input type="checkbox" checked={selected} onChange={() => toggleShelfContent(item._id)} style={{ accentColor: shelfForm.accentColor }} />
                                <div className={styles.shelfContentThumb} style={{ backgroundImage: thumb ? `url(${thumb})` : undefined }} />
                                <span className={styles.shelfContentTitle}>{item.title}</span>
                                <span className={styles.shelfContentType}>{item.type}</span>
                              </label>
                            )
                          })}
                        {contentItems.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 12 }}>No content in library yet.</p>}
                      </div>
                    </div>
                  </div>
                </div>
                <div className={styles.modalFooter}>
                  <button className={styles.ghostBtn} onClick={closeShelfModal}>Cancel</button>
                  <button className={styles.primaryBtn} disabled={shelfBusy} onClick={handleShelfSave}>
                    {shelfBusy ? 'Saving…' : editingShelfId ? 'Save Changes' : 'Create Shelf'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Shelf list header */}
          <div className={styles.libraryHeader}>
            <h2 className={styles.cardTitle}><Layers size={16} /> Curated Shelves</h2>
            <button className={styles.primaryBtn} style={{ padding: '7px 16px', fontSize: 12 }} onClick={openCreateShelf}>
              + New Shelf
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20, marginTop: -8 }}>
            Create themed rows that appear on the home page. Drag to reorder. Each shelf can mix films, series, and documentaries.
          </p>

          {shelvesLoading && <p className={styles.empty}>Loading shelves…</p>}

          {!shelvesLoading && shelves.length === 0 && (
            <div className={styles.creatorEmptyState}>
              <Layers size={28} className={styles.creatorEmptyIcon} />
              <p className={styles.creatorEmptyTitle}>No shelves yet</p>
              <p className={styles.creatorEmptyDesc}>Create your first curated shelf to feature themed collections on the home page.</p>
            </div>
          )}

          {shelves.map((shelf, idx) => (
            <div
              key={shelf._id}
              className={[
                styles.shelfRow,
                dragShelfIdx === idx    ? styles.shelfRowDragging : '',
                dragOverShelfIdx === idx && dragShelfIdx !== idx ? styles.shelfRowDragOver : '',
              ].join(' ')}
              draggable
              onDragStart={() => { setDragShelfIdx(idx); setDragOverShelfIdx(null) }}
              onDragEnter={() => setDragOverShelfIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDragOverShelfIdx(null)}
              onDrop={() => handleShelfDrop(idx)}
              onDragEnd={() => { setDragShelfIdx(null); setDragOverShelfIdx(null) }}
              style={{ borderLeftColor: shelf.accentColor }}
            >
              {/* Backdrop thumbnail */}
              <div className={styles.shelfThumb} style={{
                backgroundImage: shelf.backdropUrl ? `url(${shelf.backdropUrl})` : undefined,
                background: shelf.backdropUrl ? undefined : `linear-gradient(135deg, ${shelf.accentColor}22, ${shelf.accentColor}08)`,
                borderColor: shelf.accentColor + '33',
              }} />

              {/* Info */}
              <div className={styles.shelfInfo}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <p className={styles.shelfName}>{shelf.name}</p>
                  <span className={styles.shelfAccentDot} style={{ background: shelf.accentColor }} />
                  {!shelf.isActive && <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700, textTransform: 'uppercase' }}>Hidden</span>}
                </div>
                {shelf.tagline && <p className={styles.shelfTagline}>{shelf.tagline}</p>}
                <p className={styles.shelfMeta}>{(shelf.contentIds || []).length} item{(shelf.contentIds || []).length !== 1 ? 's' : ''}</p>
              </div>

              {/* Drag handle */}
              <GripVertical size={14} className={styles.epDragHandle} title="Drag to reorder" />

              {/* Actions */}
              <div className={styles.libraryActions}>
                <button
                  className={`${styles.proToggleBtn} ${shelf.isActive ? styles.proToggleBtnOn : ''}`}
                  onClick={() => handleShelfToggleActive(shelf)}
                  title={shelf.isActive ? 'Hide from home page' : 'Show on home page'}
                >
                  <Eye size={11} />
                  {shelf.isActive ? 'Visible' : 'Hidden'}
                </button>
                <button className={styles.editBtn} onClick={() => openEditShelf(shelf)}>
                  <Pencil size={12} /> Edit
                </button>
                <button
                  className={styles.editBtn}
                  style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
                  onClick={() => handleShelfDelete(shelf._id)}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── PAYMENTS TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'payments' && paymentConfig && (
        <div className={styles.paymentsPanel}>

          {/* Hero row */}
          <div className={styles.paymentHero}>
            <div className={styles.paymentHeroLeft}>
              <p className={styles.paymentHeroLabel}>Active Provider</p>
              <div className={styles.paymentHeroProvider}>
                <Zap size={18} className={styles.paymentHeroIcon} />
                <span className={styles.paymentHeroName}>
                  {paymentConfig.providerStatus?.[paymentConfig.activeProvider]?.displayName || paymentConfig.activeProvider}
                </span>
                <span className={`${styles.modePill} ${paymentConfig.mode === 'live' ? styles.modePillLive : styles.modePillTest}`}>
                  {paymentConfig.mode === 'live' ? '● LIVE' : '○ TEST'}
                </span>
              </div>
              {paymentConfig.mode === 'live' && (
                <p className={styles.liveWarningText}>
                  <AlertTriangle size={12} /> Real payments are being processed
                </p>
              )}
            </div>
            <div className={styles.paymentHeroRight}>
              <p className={styles.paymentHeroLabel}>Mode</p>
              <div className={styles.modeToggleGroup}>
                <button
                  className={`${styles.modeToggleBtn} ${paymentConfig.mode === 'test' ? styles.modeToggleBtnActive : ''}`}
                  onClick={() => paymentConfig.mode !== 'test' && handleSetMode('test')}
                  disabled={paymentBusy || paymentConfig.mode === 'test'}
                >
                  Test
                </button>
                <button
                  className={`${styles.modeToggleBtn} ${paymentConfig.mode === 'live' ? styles.modeToggleBtnLive : ''}`}
                  onClick={() => paymentConfig.mode !== 'live' && handleSetMode('live')}
                  disabled={paymentBusy || paymentConfig.mode === 'live'}
                >
                  Live
                </button>
              </div>
            </div>
          </div>

          {/* Provider cards */}
          <div className={styles.providerGrid}>
            {paymentConfig.supportedProviders?.map((providerKey) => {
              const status  = paymentConfig.providerStatus?.[providerKey]
              const isActive = paymentConfig.activeProvider === providerKey
              return (
                <div key={providerKey} className={`${styles.providerCard} ${isActive ? styles.providerCardActive : ''}`}>
                  <div className={styles.providerCardTop}>
                    <div className={styles.providerCardHeader}>
                      <span className={styles.providerCardName}>{status?.displayName || providerKey}</span>
                      {isActive && <span className={styles.activeBadge}>ACTIVE</span>}
                    </div>
                    {status?.configured ? (
                      <div className={styles.configuredRow}>
                        <Check size={12} className={styles.configuredIcon} />
                        <span className={styles.configuredText}>Configured</span>
                        {status.publicKeyHint && (
                          <code className={styles.keyHint}>{status.publicKeyHint}</code>
                        )}
                      </div>
                    ) : (
                      <div className={styles.unconfiguredRow}>
                        <AlertTriangle size={12} className={styles.unconfiguredIcon} />
                        <span className={styles.unconfiguredText}>Env vars missing</span>
                      </div>
                    )}
                  </div>

                  {status?.webhookUrl && (
                    <div className={styles.webhookBlock}>
                      <p className={styles.webhookLabel}>Webhook endpoint</p>
                      <div className={styles.webhookRow}>
                        <code className={styles.webhookCode}>{status.webhookUrl}</code>
                        <button
                          className={styles.copyBtn}
                          onClick={() => copyWebhookUrl(providerKey, status.webhookUrl)}
                          title="Copy"
                        >
                          {copiedWebhook === providerKey ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {!isActive && (
                    <button
                      className={styles.activateBtn}
                      disabled={paymentBusy || !status?.configured}
                      onClick={() => handleSetProvider(providerKey)}
                      title={!status?.configured ? 'Set env vars before activating' : undefined}
                    >
                      {!status?.configured ? 'Not configured' : 'Activate'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Developer callout */}
          <div className={styles.devCallout}>
            <div className={styles.devCalloutHeader}>
              <Code2 size={15} className={styles.devCalloutIcon} />
              <span>Adding a new payment provider</span>
            </div>
            <ol className={styles.devCalloutSteps}>
              <li>Create <code>backend/src/providers/stripe.js</code> implementing the adapter interface</li>
              <li>Register it in <code>backend/src/providers/index.js</code> under <code>ADAPTERS</code></li>
              <li>Add the provider's env vars to your secrets config</li>
              <li>Redeploy — it will appear here and can be activated without further code changes</li>
            </ol>
          </div>
        </div>
      )}

      {activeTab === 'payments' && !paymentConfig && (
        <div className={styles.paymentsPanel}>
          <p className={styles.empty}>Loading payment config…</p>
        </div>
      )}

      {/* ── CREATOR HUB TAB ──────────────────────────────────────────────── */}
      {activeTab === 'creators' && (
        <div className={styles.paymentsPanel}>

          {/* Reject reason modal */}
          {rejectModal && (
            <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && (setRejectModal(null), setRejectReason(''))}>
              <div className={styles.modalPanel} style={{ maxWidth: 420 }} role="dialog" aria-modal="true">
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}><AlertTriangle size={14} /> Reject — Add Reason</h2>
                  <button className={styles.modalClose} onClick={() => { setRejectModal(null); setRejectReason('') }}><X size={16} /></button>
                </div>
                <div style={{ padding: '16px 24px 24px' }}>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                    This reason will be shown to <strong>{rejectModal.name}</strong>.
                  </p>
                  <textarea
                    className={`${styles.input} ${styles.textarea}`}
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Video quality too low, missing metadata…"
                  />
                  <div className={styles.modalFooter} style={{ marginTop: 16 }}>
                    <button className={styles.ghostBtn} onClick={() => { setRejectModal(null); setRejectReason('') }}>Cancel</button>
                    <button className={styles.primaryBtn} style={{ background: '#dc2626' }} disabled={!rejectReason.trim() || creatorBusy} onClick={handleRejectCreator}>
                      Confirm Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab switcher */}
          <div className={styles.hubTabBar}>
            {[
              { id: 'applications', label: 'New Creators',      icon: <UserCheck size={13} />, badge: creatorApplications.filter(a => a.creatorStatus === 'applied').length || null },
              { id: 'submissions',  label: 'Content Review',    icon: <FileCheck size={13} />, badge: submissions.filter(s => s.submissionStatus === 'pending').length || null },
              { id: 'reels',        label: 'Reels Review',      icon: <Zap size={13} />,       badge: adminReels.filter(r => r.submissionStatus === 'pending').length || null },
            ].map(({ id, label, icon, badge }) => (
              <button
                key={id}
                className={`${styles.hubTab} ${creatorHubTab === id ? styles.hubTabActive : ''}`}
                onClick={() => setCreatorHubTab(id)}
              >
                {icon}
                {label}
                {badge ? <span className={styles.hubTabBadge}>{badge}</span> : null}
              </button>
            ))}
          </div>

          {/* ── Applications sub-tab ── */}
          {creatorHubTab === 'applications' && (
            <section className={styles.jobsCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 className={styles.cardTitle}><UserCheck size={16} /> Creator Applications</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { id: 'all',      label: 'All' },
                    { id: 'applied',  label: 'Pending' },
                    { id: 'approved', label: 'Approved' },
                    { id: 'rejected', label: 'Rejected' },
                  ].map(({ id, label }) => (
                    <button
                      key={id}
                      className={appStatusFilter === id ? styles.primaryBtn : styles.secondaryBtn}
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={() => { setAppStatusFilter(id); void loadCreatorApplications(id) }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {creatorApplications.length === 0 && (
                <div className={styles.creatorEmptyState}>
                  <UserCheck size={28} className={styles.creatorEmptyIcon} />
                  <p className={styles.creatorEmptyTitle}>
                    {appStatusFilter === 'applied' ? 'No pending applications' :
                     appStatusFilter === 'approved' ? 'No approved creators yet' :
                     appStatusFilter === 'rejected' ? 'No rejected applications' :
                     'No creator applications yet'}
                  </p>
                  <p className={styles.creatorEmptyDesc}>
                    {appStatusFilter === 'applied' || appStatusFilter === 'all'
                      ? 'When users apply to become creators, their applications will appear here.'
                      : 'Switch to All or Pending to see other applications.'}
                  </p>
                </div>
              )}

              {creatorApplications.map((applicant) => (
                <div key={applicant._id} className={styles.creatorAppRow}>
                  {/* Status indicator column */}
                  <div className={`${styles.creatorAppStatus} ${
                    applicant.creatorStatus === 'approved' ? styles.creatorAppStatusApproved :
                    applicant.creatorStatus === 'rejected' ? styles.creatorAppStatusRejected :
                    styles.creatorAppStatusPending
                  }`}>
                    <span className={styles.creatorAppStatusDot} />
                    {applicant.creatorStatus === 'approved' ? 'Approved' :
                     applicant.creatorStatus === 'rejected' ? 'Rejected' :
                     'Under Review'}
                  </div>

                  {/* Info */}
                  <div className={styles.creatorAppInfo}>
                    <p className={styles.creatorAppName}>
                      {applicant.creatorProfile?.studioName || applicant.displayName || applicant.email}
                    </p>
                    <p className={styles.creatorAppMeta}>
                      {applicant.email}
                      {applicant.creatorProfile?.bio ? ` · ${applicant.creatorProfile.bio.slice(0, 80)}` : ''}
                    </p>
                    {applicant.creatorProfile?.sampleWorkUrl && (
                      <p className={styles.creatorAppPortfolio}>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginRight: 4 }}>Sample:</span>
                        <a href={applicant.creatorProfile.sampleWorkUrl} target="_blank" rel="noreferrer" style={{ color: '#a78bfa', fontSize: 12 }}>
                          {applicant.creatorProfile.sampleWorkUrl.replace(/^https?:\/\//, '')}
                        </a>
                      </p>
                    )}
                    {applicant.creatorProfile?.portfolioUrl && (
                      <p className={styles.creatorAppPortfolio}>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginRight: 4 }}>Portfolio:</span>
                        <a href={applicant.creatorProfile.portfolioUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', fontSize: 12 }}>
                          {applicant.creatorProfile.portfolioUrl.replace(/^https?:\/\//, '')}
                        </a>
                      </p>
                    )}
                    {applicant.creatorProfile?.contentTypes?.length > 0 && (
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        Plans to upload: {applicant.creatorProfile.contentTypes.join(' · ')}
                      </p>
                    )}
                    {applicant.creatorRejectionReason && (
                      <p style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>
                        Rejection reason: {applicant.creatorRejectionReason}
                      </p>
                    )}
                  </div>

                  {/* Applied date */}
                  {applicant.creatorProfile?.appliedAt && (
                    <p className={styles.creatorAppDate}>
                      {new Date(applicant.creatorProfile.appliedAt).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </p>
                  )}

                  {/* Actions */}
                  <div className={styles.libraryActions}>
                    {applicant.creatorStatus !== 'approved' && (
                      <button className={styles.editBtn} style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', borderColor: 'rgba(74,222,128,0.3)' }} disabled={creatorBusy} onClick={() => handleApproveCreator(applicant._id)}>
                        <UserCheck size={12} /> {applicant.creatorStatus === 'rejected' ? 'Re-approve' : 'Approve'}
                      </button>
                    )}
                    {applicant.creatorStatus !== 'rejected' && (
                      <button className={styles.editBtn} style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }} disabled={creatorBusy} onClick={() => { setRejectModal({ type: 'app', id: applicant._id, name: applicant.email }); setRejectReason('') }}>
                        <UserX size={12} /> {applicant.creatorStatus === 'approved' ? 'Revoke Access' : 'Reject'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* ── Content Review sub-tab ── */}
          {creatorHubTab === 'submissions' && (
            <section className={styles.jobsCard}>

              {/* Header */}
              <div className={styles.reelReviewHeader}>
                <div>
                  <h2 className={styles.cardTitle}><FileCheck size={16} /> Content Review</h2>
                  <p className={styles.cardSubtitle}>
                    {submissions.filter(s => s.submissionStatus === 'pending').length} pending ·{' '}
                    {submissions.filter(s => s.submissionStatus === 'approved').length} live ·{' '}
                    {submissions.filter(s => s.submissionStatus === 'rejected').length} rejected
                  </p>
                </div>
                <button className={styles.ghostBtn} onClick={() => void loadSubmissions(subStatusFilter)}>
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              {/* Status filter chips */}
              <div className={styles.reelFilterRow}>
                {[
                  { key: 'pending',  label: 'In Review', cls: styles.reelChipPending  },
                  { key: 'approved', label: 'Approved',  cls: styles.reelChipApproved },
                  { key: 'rejected', label: 'Rejected',  cls: styles.reelChipRejected },
                  { key: 'all',      label: 'All',        cls: ''                      },
                ].map(({ key, label, cls }) => {
                  const count = submissions.filter(s => key === 'all' || s.submissionStatus === key).length
                  return (
                    <button key={key}
                      className={`${styles.reelFilterChip} ${cls} ${subStatusFilter === key ? styles.reelFilterChipActive : ''}`}
                      onClick={() => { setSubStatusFilter(key); void loadSubmissions(key) }}
                    >
                      {label}
                      <span className={styles.reelFilterCount}>{count}</span>
                    </button>
                  )
                })}
              </div>

              {/* Empty state */}
              {submissions.length === 0 && (
                <div className={styles.reelEmptyState}>
                  <FileCheck size={28} className={styles.reelEmptyIcon} />
                  <p className={styles.reelEmptyTitle}>No {subStatusFilter !== 'all' ? subStatusFilter : ''} submissions</p>
                  <p className={styles.reelEmptySub}>
                    {subStatusFilter === 'pending' ? 'All caught up — no content waiting for review.' : `No ${subStatusFilter} submissions to show.`}
                  </p>
                </div>
              )}

              {/* Submission rows */}
              <div className={styles.reelList}>
                {submissions.map((sub) => {
                  const isPending  = sub.submissionStatus === 'pending'
                  const isApproved = sub.submissionStatus === 'approved'
                  const statusColor = isPending ? '#f472b6' : isApproved ? '#4ade80' : '#f87171'
                  const statusLabel = isPending ? 'In Review' : isApproved ? 'Live' : 'Rejected'

                  return (
                    <div key={sub._id} className={`${styles.reelRow} ${isPending ? styles.reelRowPending : ''}`}>

                      {/* Poster thumbnail */}
                      <div
                        className={styles.reelThumb}
                        style={sub.posterUrl ? { backgroundImage: `url(${sub.posterUrl})` } : { background: 'linear-gradient(160deg,#0d1f3c,#1a4a8a)' }}
                      >
                        {!sub.posterUrl && <Film size={14} className={styles.reelThumbIcon} />}
                      </div>

                      {/* Info */}
                      <div className={styles.reelInfo}>
                        <div className={styles.reelInfoTop}>
                          <span className={styles.reelTitle}>
                            {sub.title}
                            <span style={{ fontWeight: 400, fontSize: 12, color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>({sub.type})</span>
                          </span>
                          <span
                            className={styles.reelStatusBadge}
                            style={{ color: statusColor, background: `${statusColor}18`, borderColor: `${statusColor}30` }}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        <p className={styles.reelMeta}>
                          by <strong>{sub.creatorId?.creatorProfile?.studioName || sub.creatorId?.email || 'Unknown Creator'}</strong>
                          {sub.revisionCount > 0 && <span className={styles.reelMetaChip}>Rev #{sub.revisionCount}</span>}
                          {sub.genre?.length > 0 && <span className={styles.reelMetaChip}>{sub.genre.slice(0, 2).join(', ')}</span>}
                        </p>

                        {sub.submissionStatus === 'rejected' && sub.rejectionReason && (
                          <p className={styles.reelRejectReason}>
                            <XCircle size={11} /> {sub.rejectionReason.slice(0, 80)}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className={styles.reelActions}>
                        {sub.submissionStatus !== 'approved' && (
                          <button className={styles.approveBtn} disabled={creatorBusy}
                            onClick={() => handleApproveSubmission(sub._id)}>
                            <FileCheck size={13} /> Approve
                          </button>
                        )}
                        {sub.submissionStatus !== 'rejected' && (
                          <button className={styles.dangerBtn} disabled={creatorBusy}
                            onClick={() => { setRejectModal({ type: 'sub', id: sub._id, name: sub.title }); setRejectReason('') }}>
                            <FileX size={13} /> Reject
                          </button>
                        )}
                      </div>

                    </div>
                  )
                })}
              </div>

            </section>
          )}

          {/* ── Reels Review sub-tab ── */}
          {creatorHubTab === 'reels' && (
            <section className={styles.jobsCard}>

              {/* Header row */}
              <div className={styles.reelReviewHeader}>
                <div>
                  <h2 className={styles.cardTitle}><Zap size={16} /> Reels Review</h2>
                  <p className={styles.cardSubtitle}>
                    {adminReels.filter(r => r.submissionStatus === 'pending').length} pending ·{' '}
                    {adminReels.filter(r => r.submissionStatus === 'approved').length} live ·{' '}
                    {adminReels.filter(r => r.submissionStatus === 'rejected').length} rejected
                  </p>
                </div>
                <button className={styles.ghostBtn} onClick={() => loadAdminReels()}>
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              {/* Status filter chips */}
              <div className={styles.reelFilterRow}>
                {[
                  { key: 'pending',  label: 'In Review', cls: styles.reelChipPending  },
                  { key: 'approved', label: 'Approved',  cls: styles.reelChipApproved },
                  { key: 'rejected', label: 'Rejected',  cls: styles.reelChipRejected },
                  { key: 'all',      label: 'All',        cls: ''                      },
                ].map(({ key, label, cls }) => {
                  const count = adminReels.filter(r => key === 'all' || r.submissionStatus === key).length
                  return (
                    <button key={key}
                      className={`${styles.reelFilterChip} ${cls} ${reelsFilter === key ? styles.reelFilterChipActive : ''}`}
                      onClick={() => setReelsFilter(key)}
                    >
                      {label}
                      <span className={styles.reelFilterCount}>{count}</span>
                    </button>
                  )
                })}
              </div>

              {(() => {
                const visibleReels = reelsFilter === 'all'
                  ? adminReels
                  : adminReels.filter(r => r.submissionStatus === reelsFilter)
                return reelsLoading ? (
                  <div className={styles.empty} style={{ padding: '48px 0', textAlign: 'center' }}>
                    Loading reels…
                  </div>
                ) : visibleReels.length === 0 ? (
                  <div className={styles.reelEmptyState}>
                    <Zap size={28} className={styles.reelEmptyIcon} />
                    <p className={styles.reelEmptyTitle}>No {reelsFilter !== 'all' ? reelsFilter : ''} reels</p>
                    <p className={styles.reelEmptySub}>
                      {reelsFilter === 'pending' ? 'All caught up — no reels waiting for review.' : `No ${reelsFilter} reels to show.`}
                    </p>
                  </div>
                ) : (
                  <div className={styles.reelList}>
                    {visibleReels.map((reel) => {
                    const creator   = reel.creatorId
                    const name      = creator?.creatorProfile?.studioName || creator?.displayName || '—'
                    const isPending = reel.submissionStatus === 'pending'
                    const isApproved= reel.submissionStatus === 'approved'
                    const bunnyLib  = import.meta.env.VITE_BUNNY_STREAM_LIBRARY_ID
                    const embedUrl  = reel.bunnyVideoId && bunnyLib
                      ? `https://iframe.mediadelivery.net/embed/${bunnyLib}/${reel.bunnyVideoId}?autoplay=false&muted=true`
                      : null

                    const statusColor = isPending ? '#f472b6' : isApproved ? '#4ade80' : '#f87171'
                    const statusLabel = isPending ? 'In Review' : isApproved ? 'Live' : 'Rejected'

                    return (
                      <div key={reel._id} className={`${styles.reelRow} ${isPending ? styles.reelRowPending : ''}`}>

                        {/* 9:16 thumbnail */}
                        <div
                          className={styles.reelThumb}
                          style={reel.thumbnailUrl ? { backgroundImage: `url(${reel.thumbnailUrl})` } : {}}
                        >
                          {!reel.thumbnailUrl && <Zap size={14} className={styles.reelThumbIcon} />}
                          {reel.durationSecs > 0 && (
                            <span className={styles.reelThumbDur}>{reel.durationSecs}s</span>
                          )}
                        </div>

                        {/* Info */}
                        <div className={styles.reelInfo}>
                          <div className={styles.reelInfoTop}>
                            <span className={styles.reelTitle}>
                              {reel.title || <em className={styles.reelTitleEmpty}>No caption</em>}
                            </span>
                            <span
                              className={styles.reelStatusBadge}
                              style={{ color: statusColor, background: `${statusColor}18`, borderColor: `${statusColor}30` }}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <p className={styles.reelMeta}>
                            by <strong>{name}</strong>
                            {reel.aspectRatio && <span className={styles.reelMetaChip}>{reel.aspectRatio}</span>}
                            {reel.createdAt && (
                              <span className={styles.reelMetaChip}>
                                {new Date(reel.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </p>

                          {reel.hashtags?.length > 0 && (
                            <p className={styles.reelHashtags}>#{reel.hashtags.slice(0, 4).join(' #')}</p>
                          )}

                          {reel.submissionStatus === 'rejected' && reel.rejectionReason && (
                            <p className={styles.reelRejectReason}>
                              <XCircle size={11} /> {reel.rejectionReason}
                            </p>
                          )}

                          <div className={styles.reelStats}>
                            <span><Eye size={11} /> {reel.viewCount || 0}</span>
                            <span><Heart size={11} /> {reel.likeCount || 0}</span>
                            <span><MessageCircle size={11} /> {reel.commentCount || 0}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className={styles.reelActions}>
                          {embedUrl && (
                            <button className={styles.ghostBtn} onClick={() => setReelPreview(reel)}>
                              <Play size={13} /> Preview
                            </button>
                          )}
                          {isPending && (
                            <>
                              <button
                                className={styles.approveBtn}
                                disabled={reelBusy}
                                onClick={async () => { setReelBusy(true); try { await approveAdminReel(reel._id); loadAdminReels() } catch(e) { showToast({ type:'error', message: e?.message || 'Failed' }) } setReelBusy(false) }}
                              >
                                <CheckCircle2 size={13} /> Approve
                              </button>
                              <button
                                className={styles.dangerBtn}
                                disabled={reelBusy}
                                onClick={() => { setReelRejectModal(reel); setReelRejectReason('') }}
                              >
                                <XCircle size={13} /> Reject
                              </button>
                            </>
                          )}
                          {!isPending && (
                            <button
                              className={styles.dangerBtn}
                              disabled={reelBusy}
                              onClick={async () => { if (!window.confirm('Delete this reel?')) return; setReelBusy(true); try { await deleteAdminReel(reel._id); loadAdminReels() } catch(e) { showToast({ type:'error', message: e?.message || 'Failed' }) } setReelBusy(false) }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  </div>
                )
              })()}
            </section>
          )}

          {/* Reel video preview */}
          {reelPreview && (() => {
            const bunnyLib = import.meta.env.VITE_BUNNY_STREAM_LIBRARY_ID
            const embedUrl = `https://iframe.mediadelivery.net/embed/${bunnyLib}/${reelPreview.bunnyVideoId}?autoplay=true&muted=false`
            return (
              <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onClick={() => setReelPreview(null)}>
                <div style={{ position: 'relative', width: '100%', maxWidth: 400 }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setReelPreview(null)}
                    style={{ position: 'absolute', top: -40, right: 0, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <X size={16} /> Close preview
                  </button>
                  <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: reelPreview.aspectRatio === '16:9' ? '16/9' : reelPreview.aspectRatio === '1:1' ? '1/1' : '9/16' }}>
                    <iframe src={embedUrl} style={{ width: '100%', height: '100%', border: 'none' }} allow="autoplay; fullscreen" allowFullScreen title={reelPreview.title || 'Reel preview'} />
                  </div>
                  <p style={{ color: '#fff', fontWeight: 600, marginTop: 12 }}>{reelPreview.title || 'No caption'}</p>
                </div>
              </div>
            )
          })()}

          {/* Reel reject modal */}
          {reelRejectModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
              onClick={() => setReelRejectModal(null)}>
              <div style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
                <h3 style={{ color: '#fff', margin: '0 0 8px', fontSize: 15 }}>Reject reel</h3>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: '0 0 16px' }}>
                  "{reelRejectModal.title || 'No caption'}" — this reason will be shown to the creator.
                </p>
                <textarea style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, resize: 'vertical', minHeight: 80, fontFamily: 'inherit', outline: 'none' }}
                  placeholder="Reason for rejection…"
                  value={reelRejectReason}
                  onChange={e => setReelRejectReason(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                  <button className={styles.ghostBtn} onClick={() => setReelRejectModal(null)}>Cancel</button>
                  <button className={styles.dangerBtn} disabled={!reelRejectReason.trim() || reelBusy}
                    onClick={async () => { setReelBusy(true); try { await rejectAdminReel(reelRejectModal._id, reelRejectReason.trim()); setReelRejectModal(null); loadAdminReels() } catch(e) { alert(e?.message) } setReelBusy(false) }}>
                    <XCircle size={13} /> Confirm Reject
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* Edit / Create metadata modal — shown on any tab */}
      {editingId && (() => {
        const isCreateMode = editingId === NEW_CONTENT_ID
        return (
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && closeEditModal()}>
          <div className={styles.modalPanel} role="dialog" aria-modal="true" aria-label={isCreateMode ? 'New content' : 'Edit metadata'} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                {isCreateMode && (
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--color-accent)', margin: '0 0 4px' }}>
                    New Content
                  </p>
                )}
                <h2 className={styles.modalTitle}>
                  {isCreateMode ? <><Plus size={14} /> Create Content</> : <><Pencil size={14} /> Edit Metadata</>}
                </h2>
              </div>
              <button className={styles.modalClose} onClick={closeEditModal} aria-label="Close"><X size={16} /></button>
            </div>

            {editBusy && !editForm && <p className={styles.empty}>Loading…</p>}
            {editNotice && <p className={`${styles.message} ${styles.notice}`}>{editNotice}</p>}
            {editError  && <p className={`${styles.message} ${styles.error}`}>{editError}</p>}

            {editForm && (
              <form ref={modalFormRef} className={styles.modalForm} onSubmit={handleEditSave} id="edit-metadata-form">
                <div className={styles.modalGrid}>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Title *
                    <input className={styles.input} value={editForm.title} onChange={ef('title')} required />
                  </label>
                  <label className={styles.label}>
                    Subtitle / Tagline
                    <input className={styles.input} value={editForm.subtitle} onChange={ef('subtitle')} placeholder="e.g. একটি রহস্য কাহিনী" />
                  </label>
                  <label className={styles.label}>
                    Type
                    <select className={styles.select} value={editForm.type} onChange={ef('type')}>
                      <option value="Film">Film</option>
                      <option value="Series">Series</option>
                      <option value="Serial Drama">Serial Drama</option>
                      <option value="Documentary">Documentary</option>
                      <option value="Live">Live</option>
                    </select>
                  </label>
                  {editForm.type !== 'Series' && editForm.type !== 'Serial Drama' && (
                    <label className={styles.label}>
                      Duration <span className={styles.labelHint}>(e.g. 1h 45m, 105m)</span>
                      <input
                        className={`${styles.input} ${editForm.duration && !isValidDuration(editForm.duration) ? styles.inputError : ''}`}
                        value={editForm.duration || ''}
                        onChange={ef('duration')}
                        placeholder="1h 45m"
                      />
                      {editForm.duration && !isValidDuration(editForm.duration) && (
                        <span style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>
                          Use: 42m · 2h · 1h 20m · 1:20
                        </span>
                      )}
                    </label>
                  )}
                  <label className={styles.label}>
                    Language
                    <select className={styles.select} value={editForm.contentLanguage || ''} onChange={ef('contentLanguage')}>
                      <option value="">— Select —</option>
                      <option value="Bengali">Bengali (বাংলা)</option>
                      <option value="Hindi">Hindi (হিন্দি)</option>
                      <option value="English">English</option>
                      <option value="Odia">Odia</option>
                      <option value="Tamil">Tamil</option>
                      <option value="Telugu">Telugu</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    Certification (CBFC)
                    <select className={styles.select} value={editForm.certification || ''} onChange={ef('certification')}>
                      <option value="">— Select —</option>
                      <option value="U">U — Universal</option>
                      <option value="UA">UA — Parental Guidance</option>
                      <option value="A">A — Adults Only</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    <span>Genre <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.genre} onChange={ef('genre')} placeholder="Drama, Thriller, Romance" />
                    <div className={styles.quickTags}>
                      {['Drama','Thriller','Romance','Crime','Comedy','Historical','Family','Supernatural','Action','Social'].map((g) => (
                        <button key={g} type="button" className={styles.quickTag}
                          onClick={() => {
                            const existing = editForm.genre.split(',').map((s) => s.trim()).filter(Boolean)
                            if (!existing.includes(g)) setEditForm((prev) => ({ ...prev, genre: [...existing, g].join(', ') }))
                          }}>
                          {g}
                        </button>
                      ))}
                    </div>
                  </label>
                  <label className={styles.label}>
                    Director
                    <input className={styles.input} value={editForm.director} onChange={ef('director')} placeholder="পরিচালকের নাম" />
                  </label>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    <span>Cast <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.cast} onChange={ef('cast')} placeholder="Prosenjit Chatterjee, Rituparna Sengupta" />
                  </label>
                  <label className={styles.label}>
                    Release Year
                    <input className={styles.input} type="number" min="1900" max="2099" value={editForm.releaseYear} onChange={ef('releaseYear')} placeholder="2024" />
                  </label>
                  <label className={styles.label}>
                    <span>Rating <span className={styles.labelHint}>(0–5)</span></span>
                    <input className={styles.input} type="number" min="0" max="5" step="0.1" value={editForm.rating} onChange={ef('rating')} placeholder="4.2" />
                  </label>
                  <label className={styles.label}>
                    Review Count
                    <input className={styles.input} type="number" min="0" value={editForm.reviewCount} onChange={ef('reviewCount')} placeholder="12400" />
                  </label>
                  <label className={styles.label}>
                    Badge
                    <input className={styles.input} value={editForm.badge} onChange={ef('badge')} placeholder="NEW / EXCLUSIVE" />
                  </label>
                  <label className={styles.label}>
                    <span>Content Warnings <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.contentWarnings} onChange={ef('contentWarnings')} placeholder="violence, language, tobacco use" />
                  </label>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    <span>Mood Tags <span className={styles.labelHint}>(comma-separated, e.g. "Quirky, Romantic")</span></span>
                    <input className={styles.input} value={editForm.moodTags} onChange={ef('moodTags')} placeholder="Emotional, Suspenseful" />
                  </label>

                  <div className={`${styles.imagesSection} ${styles.spanFull}`}>
                    <p className={styles.imagesSectionTitle}><ImagePlus size={13} /> Images</p>
                    <div className={styles.imageGrid}>
                      {[
                        { field: 'posterUrl',   label: 'Poster',   hint: '2:3 portrait · cards & modal',    key: 'poster' },
                        { field: 'backdropUrl', label: 'Backdrop', hint: '16:9 landscape · hero & featured', key: 'backdrop' },
                      ].map(({ field, label, hint, key }) => (
                        <div key={field} className={styles.imageSlot}>
                          <p className={styles.imageSlotLabel}>{label} <span className={styles.labelHint}>{hint}</span></p>
                          <div className={styles.imagePreviewWrap}>
                            {editForm[field]
                              ? (
                                <>
                                  <img src={editForm[field]} className={styles.imagePreview} alt={`${label} preview`} />
                                  <button
                                    type="button"
                                    className={styles.imageClearBtn}
                                    onClick={() => setEditForm((prev) => ({ ...prev, [field]: '' }))}
                                    aria-label={`Remove ${label}`}
                                  >
                                    <X size={12} />
                                  </button>
                                </>
                              )
                              : <div className={styles.imageEmpty}><ImagePlus size={22} opacity={0.3} /><span>No image</span></div>
                            }
                          </div>
                          <label className={styles.imageUploadBtn}>
                            {imgUploading[key] ? `Uploading… ${imgProgress[key]}%` : `Upload ${label}`}
                            <input type="file" accept="image/*" className={styles.fileInputHidden} disabled={imgUploading[key]} onChange={(e) => handleImageUpload(field, e.target.files?.[0])} />
                          </label>
                          <input className={styles.input} value={editForm[field]} onChange={ef(field)} placeholder="Or paste URL…" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {editForm.bunnyVideoId && (
                    <div className={`${styles.label} ${styles.spanFull}`}>
                      Stream Video ID
                      <div className={styles.readonlyField}>
                        <span>{editForm.bunnyVideoId}</span>
                        <span className={styles.readonlyNote}>Linked via Upload or Map</span>
                      </div>
                    </div>
                  )}

                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Synopsis / Description
                    <textarea className={`${styles.input} ${styles.textarea}`} value={editForm.desc} onChange={ef('desc')} rows={4} placeholder="গল্পের সারসংক্ষেপ লিখুন…" />
                  </label>

                  <div className={styles.toggleRow}>
                    <label className={styles.toggleLabel}>
                      <input type="checkbox" checked={editForm.isPremium} onChange={ef('isPremium')} />
                      <span>Premium (PRO)</span>
                    </label>
                    <label className={styles.toggleLabel}>
                      <input type="checkbox" checked={editForm.isFeatured} onChange={ef('isFeatured')} />
                      <span>Featured on Home</span>
                    </label>
                  </div>

                  {/* ── Episodes (Series and Serial Drama) ── */}
                  {(editForm.type === 'Series' || editForm.type === 'Serial Drama') && (
                    <div className={`${styles.episodeSection} ${styles.spanFull}`}>
                      <div className={styles.episodeSectionHeader}>
                        <p className={styles.episodeSectionTitle}><ListPlus size={13} /> Episodes</p>
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          style={{ padding: '4px 12px', fontSize: 12 }}
                          onClick={() => {
                            const next = editForm.episodes.length > 0
                              ? Math.max(...editForm.episodes.map((e) => e.number)) + 1
                              : 1
                            setEditForm((prev) => ({
                              ...prev,
                              episodes: [...prev.episodes, { number: next, title: '', duration: '', bunnyVideoId: '' }],
                            }))
                          }}
                        >
                          + Add Episode
                        </button>
                      </div>

                      {editForm.episodes.length === 0 && (
                        <p className={styles.episodeEmpty}>No episodes yet. Click "Add Episode" to start.</p>
                      )}

                      {editForm.episodes.map((ep, idx) => (
                        <div
                          key={idx}
                          className={`${styles.episodeRow} ${dragEpIdx === idx ? styles.episodeRowDragging : ''}`}
                          draggable
                          onDragStart={() => setDragEpIdx(idx)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragEpIdx === null || dragEpIdx === idx) { setDragEpIdx(null); return }
                            setEditForm((prev) => {
                              const eps = [...prev.episodes]
                              const [moved] = eps.splice(dragEpIdx, 1)
                              eps.splice(idx, 0, moved)
                              return { ...prev, episodes: eps }
                            })
                            setDragEpIdx(null)
                          }}
                          onDragEnd={() => setDragEpIdx(null)}
                        >
                          <GripVertical size={13} className={styles.epDragHandle} title="Drag to reorder" />
                          <span className={styles.episodeNum}>{ep.number}</span>
                          <input
                            className={`${styles.input} ${styles.epInput}`}
                            value={ep.title}
                            onChange={(e) => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.map((x, i) => i === idx ? { ...x, title: e.target.value } : x),
                            }))}
                            placeholder="Episode title"
                          />
                          <input
                            className={`${styles.input} ${styles.epInput} ${styles.epInputShort}`}
                            value={ep.duration}
                            onChange={(e) => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.map((x, i) => i === idx ? { ...x, duration: e.target.value } : x),
                            }))}
                            placeholder="42m"
                          />
                          <input
                            className={`${styles.input} ${styles.epInput}`}
                            value={ep.bunnyVideoId}
                            onChange={(e) => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.map((x, i) => i === idx ? { ...x, bunnyVideoId: e.target.value } : x),
                            }))}
                            placeholder="Bunny video ID"
                          />
                          <button
                            type="button"
                            className={styles.epDeleteBtn}
                            onClick={() => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.filter((_, i) => i !== idx),
                            }))}
                            aria-label="Remove episode"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </form>
            )}

            <div className={styles.modalFooter}>
              <button type="button" className={styles.ghostBtn} onClick={closeEditModal}>
                {editNotice && !isCreateMode ? 'Close' : 'Cancel'}
              </button>
              {/* After successful creation, show a Go to Uploads CTA */}
              {isCreateMode && editNotice && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  style={{ background: '#db2777' }}
                  onClick={() => {
                    closeEditModal()
                    setActiveTab('uploads')
                  }}
                >
                  <UploadIcon size={13} /> Go to Uploads
                </button>
              )}
              <button
                type="submit"
                form="edit-metadata-form"
                className={styles.primaryBtn}
                disabled={editBusy || !editForm || (isCreateMode && Boolean(editNotice))}
              >
                {editBusy
                  ? (isCreateMode ? 'Creating…' : 'Saving…')
                  : (isCreateMode ? 'Create Content' : 'Save Metadata')}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* ── Reel video preview modal ── */}
      {reelPreview && (() => {
        const bunnyLib = import.meta.env.VITE_BUNNY_STREAM_LIBRARY_ID
        const embedUrl = `https://iframe.mediadelivery.net/embed/${bunnyLib}/${reelPreview.bunnyVideoId}?autoplay=true&muted=false`
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setReelPreview(null)}
          >
            <div style={{ position: 'relative', width: '100%', maxWidth: 400 }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setReelPreview(null)}
                style={{ position: 'absolute', top: -40, right: 0, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <X size={16} /> Close preview
              </button>
              <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: reelPreview.aspectRatio === '16:9' ? '16/9' : reelPreview.aspectRatio === '1:1' ? '1/1' : '9/16' }}>
                <iframe
                  src={embedUrl}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  allow="autoplay; fullscreen"
                  allowFullScreen
                  title={reelPreview.title || 'Reel preview'}
                />
              </div>
              <div style={{ marginTop: 12, color: '#fff' }}>
                <p style={{ fontWeight: 600, margin: 0 }}>{reelPreview.title || 'No caption'}</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '4px 0 0' }}>
                  by {reelPreview.creatorId?.creatorProfile?.studioName || reelPreview.creatorId?.displayName || '—'}
                </p>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Reel reject modal ── */}
      {reelRejectModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setReelRejectModal(null)}
        >
          <div style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#fff', margin: '0 0 8px', fontSize: 15 }}>Reject reel</h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: '0 0 16px' }}>
              "{reelRejectModal.title || 'No caption'}" — this reason will be shown to the creator.
            </p>
            <textarea
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, resize: 'vertical', minHeight: 80, fontFamily: 'inherit', outline: 'none' }}
              placeholder="Reason for rejection…"
              value={reelRejectReason}
              onChange={e => setReelRejectReason(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className={styles.ghostBtn} onClick={() => setReelRejectModal(null)}>Cancel</button>
              <button
                className={styles.dangerBtn}
                disabled={!reelRejectReason.trim() || reelBusy}
                onClick={async () => {
                  setReelBusy(true)
                  try {
                    await rejectAdminReel(reelRejectModal._id, reelRejectReason.trim())
                    setReelRejectModal(null)
                    loadAdminReels()
                  } catch (e) { alert(e?.message || 'Failed') }
                  setReelBusy(false)
                }}
              >
                <XCircle size={13} /> Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REVENUE TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'revenue' && (() => {
        const pr   = platformRevenue || {}
        const mo   = pr.monthlyRevenue || []
        const thisM = mo.at(-1) || { revenuePaise: 0, count: 0 }
        const lastM = mo.at(-2) || { revenuePaise: 0, count: 0 }
        const momPct = lastM.revenuePaise > 0
          ? Math.round((thisM.revenuePaise - lastM.revenuePaise) / lastM.revenuePaise * 100)
          : null
        const activeSubs = pr.subscribersByStatus?.active || 0
        const arpu = activeSubs > 0 ? Math.round(thisM.revenuePaise / activeSubs / 100) : 0
        const cs   = pr.creatorSummary || {}
        const fmtRs = (paise) => {
          const r = (paise || 0) / 100
          if (r >= 100000) return `₹${(r / 100000).toFixed(1)}L`
          if (r >= 1000)   return `₹${(r / 1000).toFixed(1)}k`
          return `₹${Math.round(r).toLocaleString('en-IN')}`
        }
        return (
        <section className={styles.revDashboard}>

          {/* Calculate modal */}
          {showCalcModal && (
            <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && setShowCalcModal(false)}>
              <div className={styles.modalPanel} style={{ maxWidth: 460 }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}><Calculator size={15} /> Calculate Monthly Earnings</h2>
                  <button className={styles.modalClose} onClick={() => { setShowCalcModal(false); setCalcResult(null) }}><X size={16} /></button>
                </div>
                <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className={styles.label}>
                      Month
                      <select className={styles.select} value={calcForm.month} onChange={(e) => setCalcForm((p) => ({ ...p, month: Number(e.target.value) }))}>
                        {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                          <option key={m} value={i + 1}>{m}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.label}>
                      Year
                      <input className={styles.input} type="number" min="2024" max="2099" value={calcForm.year} onChange={(e) => setCalcForm((p) => ({ ...p, year: Number(e.target.value) }))} />
                    </label>
                  </div>
                  <label className={styles.label}>
                    Rate per view (paise) <span style={{ fontSize: 10, color: '#888', fontWeight: 400 }}>50 paise = ₹0.50 per view</span>
                    <input className={styles.input} type="number" min="1" value={calcForm.ratePerViewPaise} onChange={(e) => setCalcForm((p) => ({ ...p, ratePerViewPaise: Number(e.target.value) }))} />
                  </label>
                  {calcResult && (
                    <div style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#4ade80' }}>
                      ✓ Created <strong>{calcResult.earningsCreated}</strong> earning records · skipped {calcResult.skipped}
                    </div>
                  )}
                  {revenueError && <p style={{ fontSize: 13, color: '#f87171' }}>{revenueError}</p>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button className={styles.ghostBtn} onClick={() => { setShowCalcModal(false); setCalcResult(null) }}>Cancel</button>
                    <button className={styles.primaryBtn} onClick={handleCalculateEarnings} disabled={calcBusy}>
                      {calcBusy ? 'Calculating…' : 'Run Calculation'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Payout modal */}
          {showPayoutModal && (
            <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && setShowPayoutModal(null)}>
              <div className={styles.modalPanel} style={{ maxWidth: 440 }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}><Wallet size={15} /> Process Payout</h2>
                  <button className={styles.modalClose} onClick={() => setShowPayoutModal(null)}><X size={16} /></button>
                </div>
                <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
                    Creator: <strong style={{ color: 'var(--color-text)' }}>{showPayoutModal.studioName}</strong>
                    &nbsp;·&nbsp; Amount: <strong style={{ color: '#4ade80' }}>₹{showPayoutModal.pending.toLocaleString('en-IN')}</strong>
                  </p>
                  <label className={styles.label}>
                    Payment Method
                    <select className={styles.select} value={payoutForm.method} onChange={(e) => setPayoutForm((p) => ({ ...p, method: e.target.value }))}>
                      <option>Bank Transfer</option>
                      <option>UPI</option>
                      <option>Cheque</option>
                      <option>PayPal</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    Reference ID <span style={{ fontSize: 10, color: '#888', fontWeight: 400 }}>bank UTR / UPI txn ID</span>
                    <input className={styles.input} value={payoutForm.referenceId} onChange={(e) => setPayoutForm((p) => ({ ...p, referenceId: e.target.value }))} placeholder="UTR123456789" />
                  </label>
                  <label className={styles.label}>
                    Notes <span style={{ fontSize: 10, color: '#888', fontWeight: 400 }}>optional</span>
                    <input className={styles.input} value={payoutForm.notes} onChange={(e) => setPayoutForm((p) => ({ ...p, notes: e.target.value }))} placeholder="May 2026 payout" />
                  </label>
                  {revenueError && <p style={{ fontSize: 13, color: '#f87171' }}>{revenueError}</p>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button className={styles.ghostBtn} onClick={() => setShowPayoutModal(null)}>Cancel</button>
                    <button className={styles.primaryBtn} onClick={handleProcessPayout} disabled={payoutBusy || !payoutForm.referenceId.trim()}>
                      {payoutBusy ? 'Processing…' : 'Confirm Payout'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Section 1: Dhara Platform Revenue ── */}
          <div className={styles.revSection}>
            <div className={styles.revSectionHeader}>
              <div>
                <h2 className={styles.revSectionTitle}><IndianRupee size={16} /> Dhara Platform Revenue</h2>
                <p className={styles.revSectionSub}>Subscription income from end users</p>
              </div>
            </div>

            {revenueLoading ? <p className={styles.empty}>Loading…</p> : (
              <>
                <div className={styles.revKpiRow}>
                  <div className={`${styles.revKpiCard} ${styles.revKpiAccent}`}>
                    <div className={styles.revKpiCardIcon}><IndianRupee size={13} /></div>
                    <p className={styles.revKpiValue}>{fmtRs(pr.totalRevenuePaise)}</p>
                    <p className={styles.revKpiLabel}>All-time Revenue</p>
                    <p className={styles.revKpiSub}>{(pr.totalTransactions || 0).toLocaleString()} transactions</p>
                  </div>
                  <div className={styles.revKpiCard}>
                    <div className={styles.revKpiCardIcon}><TrendingUp size={13} /></div>
                    <p className={styles.revKpiValue}>{fmtRs(thisM.revenuePaise)}</p>
                    <p className={styles.revKpiLabel}>This Month</p>
                    {momPct !== null && (
                      <p className={`${styles.revKpiSub} ${momPct >= 0 ? styles.revKpiSubUp : styles.revKpiSubDown}`}>
                        {momPct >= 0 ? '↑' : '↓'} {Math.abs(momPct)}% vs last month
                      </p>
                    )}
                  </div>
                  <div className={styles.revKpiCard}>
                    <div className={`${styles.revKpiCardIcon} ${styles.revKpiCardIconGreen}`}><Users size={13} /></div>
                    <p className={styles.revKpiValue}>{activeSubs.toLocaleString()}</p>
                    <p className={styles.revKpiLabel}>Active Subscribers</p>
                    <p className={styles.revKpiSub}>+ {(pr.subscribersByStatus?.trial || 0)} on trial</p>
                  </div>
                  <div className={styles.revKpiCard}>
                    <div className={styles.revKpiCardIcon}><BarChart2 size={13} /></div>
                    <p className={styles.revKpiValue}>₹{arpu}</p>
                    <p className={styles.revKpiLabel}>ARPU this month</p>
                    <p className={styles.revKpiSub}>avg. revenue per active user</p>
                  </div>
                </div>

                <div className={styles.revChartRow}>
                  <div className={styles.revChartCard}>
                    <p className={styles.revChartTitle}><BarChart2 size={12} /> Monthly Revenue</p>
                    <p className={styles.revChartSub}>Last 12 months · ₹ INR · current month highlighted</p>
                    <RevMonthlyBarsChart data={pr.monthlyRevenue} />
                  </div>
                  <div className={styles.revChartCard}>
                    <p className={styles.revChartTitle}><IndianRupee size={12} /> Revenue by Plan</p>
                    <p className={styles.revChartSub}>Share of all-time subscription revenue</p>
                    <PlanDonutChart data={pr.planBreakdown} />
                  </div>
                </div>

                <div className={styles.revChartCard}>
                  <p className={styles.revChartTitle}><Users size={12} /> Subscriber Health</p>
                  <p className={styles.revChartSub}>Current distribution across all subscription states</p>
                  <SubHealthBarChart data={pr.subscribersByStatus} />
                </div>
              </>
            )}
          </div>

          {/* ── Section 2: Creator Payouts ── */}
          <div className={styles.revSection}>
            <div className={styles.revSectionHeader}>
              <div>
                <h2 className={styles.revSectionTitle}><Wallet size={16} /> Creator Payouts</h2>
                <p className={styles.revSectionSub}>Revenue share distributed to content creators</p>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
                <button className={styles.refreshBtn} onClick={loadCreatorRevenue} disabled={revenueLoading}>
                  <RefreshCw size={13} /> Refresh
                </button>
                <button className={styles.primaryBtn} style={{ padding:'7px 14px', fontSize:12 }}
                  onClick={() => { setCalcResult(null); setRevenueError(''); setShowCalcModal(true) }}>
                  <Calculator size={13} /> Calculate Earnings
                </button>
              </div>
            </div>

            {revenueNotice && <p className={`${styles.message} ${styles.notice}`}>{revenueNotice}</p>}
            {revenueError && !showCalcModal && !showPayoutModal && <p className={`${styles.message} ${styles.error}`}>{revenueError}</p>}

            {revenueLoading ? <p className={styles.empty}>Loading…</p> : (
              <>
                <div className={styles.revKpiRow}>
                  <div className={`${styles.revKpiCard} ${styles.revKpiAccentPurple}`}>
                    <div className={`${styles.revKpiCardIcon} ${styles.revKpiCardIconPurple}`}><Wallet size={13} /></div>
                    <p className={styles.revKpiValue}>{fmtRs(cs.totalPaidPaise)}</p>
                    <p className={styles.revKpiLabel}>Total Paid Out</p>
                    <p className={styles.revKpiSub}>all time to creators</p>
                  </div>
                  <div className={styles.revKpiCard}>
                    <div className={styles.revKpiCardIcon} style={{ background:'rgba(244,114,182,0.1)', borderColor:'rgba(244,114,182,0.2)', color:'#f472b6' }}><Clock size={13} /></div>
                    <p className={styles.revKpiValue} style={{ color: cs.totalPendingPaise > 0 ? '#f472b6' : undefined }}>{fmtRs(cs.totalPendingPaise)}</p>
                    <p className={styles.revKpiLabel}>Pending Payouts</p>
                    <p className={styles.revKpiSub}>awaiting processing</p>
                  </div>
                  <div className={styles.revKpiCard}>
                    <div className={`${styles.revKpiCardIcon} ${styles.revKpiCardIconGreen}`}><UserCheck size={13} /></div>
                    <p className={styles.revKpiValue}>{cs.earningCreators || 0}</p>
                    <p className={styles.revKpiLabel}>Earning Creators</p>
                    <p className={styles.revKpiSub}>with at least one record</p>
                  </div>
                  <div className={styles.revKpiCard}>
                    <div className={styles.revKpiCardIcon}><Film size={13} /></div>
                    <p className={styles.revKpiValue}>{creatorEarnings.reduce((s, c) => s + c.recordCount, 0)}</p>
                    <p className={styles.revKpiLabel}>Earning Records</p>
                    <p className={styles.revKpiSub}>monthly calculation entries</p>
                  </div>
                </div>

                {creatorEarnings.length > 0 && (
                  <div className={styles.revChartCard}>
                    <p className={styles.revChartTitle}><BarChart2 size={12} /> Top Creators by Earnings</p>
                    <p className={styles.revChartSub}>Paid out vs pending · colour-coded by creator tier</p>
                    <CreatorEarningsBarsChart data={creatorEarnings} />
                  </div>
                )}

                {creatorEarnings.length === 0 ? (
                  <div className={styles.empty} style={{ padding:'36px 24px', textAlign:'center' }}>
                    <p style={{ marginBottom:8 }}>No earnings records yet.</p>
                    <p style={{ fontSize:12, color:'var(--color-text-muted)' }}>
                      Run <strong>Calculate Earnings</strong> at month-end to generate records.
                    </p>
                  </div>
                ) : (
                  <div className={styles.revenueEarningsTable}>
                    <div className={styles.revenueEarningsHead}>
                      <span>Creator / Studio</span>
                      <span>Pending</span>
                      <span>Total Earned</span>
                      <span>Paid Out</span>
                      <span>Views</span>
                      <span>Action</span>
                    </div>
                    {creatorEarnings.map((row) => (
                      <div key={String(row.creatorId)} className={styles.revenueEarningsRow}>
                        <div>
                          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                            <p className={styles.revenueCreatorName}>{row.studioName}</p>
                            {row.tier && (
                              <span style={{ fontFamily:'var(--font-body)', fontSize:10, fontWeight:600, padding:'1px 7px', borderRadius:99, border:`1px solid ${(TIER_COLORS[row.tier] || '#6366f1')}44`, color: TIER_COLORS[row.tier] || '#6366f1', background:'transparent' }}>
                                {row.tier}
                              </span>
                            )}
                          </div>
                          <p className={styles.revenueCreatorEmail}>{row.email}</p>
                        </div>
                        <span className={styles.revenuePending} style={{ color: row.pending > 0 ? '#f472b6' : 'var(--color-text-muted)' }}>
                          ₹{row.pending.toLocaleString('en-IN')}
                        </span>
                        <span className={styles.revenueTotal}>₹{row.totalEarned.toLocaleString('en-IN')}</span>
                        <span className={styles.revenueTotal} style={{ color:'#4ade80' }}>₹{row.paidOut.toLocaleString('en-IN')}</span>
                        <span className={styles.revenueTotal}>{row.totalViews.toLocaleString()}</span>
                        <button className={styles.editBtn} disabled={row.pending < 1}
                          title={row.pending < 1 ? 'No pending balance' : `Pay ₹${row.pending.toLocaleString('en-IN')}`}
                          onClick={() => { setRevenueError(''); setPayoutForm({ method:'Bank Transfer', referenceId:'', notes:'' }); setShowPayoutModal({ creatorId:row.creatorId, studioName:row.studioName, pending:row.pending }) }}>
                          <Wallet size={12} /> Pay
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {creatorPayouts.length > 0 && (
                  <div>
                    <p className={styles.revChartTitle} style={{ margin:'8px 0 12px' }}><Clock size={13} /> Payout History</p>
                    <div className={styles.revenuePayoutHistoryTable}>
                      <div className={styles.revenuePayoutHistoryHead}>
                        <span>Creator</span><span>Amount</span><span>Method</span>
                        <span>Reference</span><span>Date</span><span>Status</span>
                      </div>
                      {creatorPayouts.map((p) => (
                        <div key={p._id} className={styles.revenuePayoutHistoryRow}>
                          <div>
                            <p className={styles.revenueCreatorName}>{p.studioName}</p>
                            <p className={styles.revenueCreatorEmail}>{p.email}</p>
                          </div>
                          <span style={{ color:'#4ade80', fontWeight:700 }}>₹{p.amountRupees.toLocaleString('en-IN')}</span>
                          <span>{p.method}</span>
                          <span style={{ fontSize:11, color:'var(--color-text-muted)', fontFamily:'monospace' }}>{p.referenceId || '—'}</span>
                          <span style={{ fontSize:12, color:'var(--color-text-muted)' }}>
                            {p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'}
                          </span>
                          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, color: p.status === 'paid' ? '#4ade80' : '#f472b6' }}>
                            {p.status === 'paid' ? <CheckCircle2 size={11} /> : <Clock size={11} />}
                            {p.status === 'paid' ? 'Paid' : 'Processing'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        )
      })()}

      {/* ── MONITOR TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'monitor' && (() => {
        const md  = monitorData
        const uh  = md?.uploadHealth || {}
        const dau = md?.dau          || {}
        const sub = md?.subscriptions || {}
        const ct  = md?.content       || {}
        const usr = md?.users          || {}

        const fmtN = (n) => {
          if (!n) return '0'
          if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
          if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
          return String(n)
        }
        const fmtAgo = (d) => {
          if (!d) return '—'
          const secs = Math.floor((Date.now() - new Date(d)) / 1000)
          if (secs < 60)  return `${secs}s ago`
          if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
          return `${Math.floor(secs / 3600)}h ago`
        }

        const failedCount   = uh.byStatus?.failed  || 0
        const activeJobs    = uh.activeJobs         || 0
        const paying        = sub.paying            || 0

        return (
        <div className={styles.monDashboard}>

          {/* Header */}
          <div className={styles.monHeader}>
            <div>
              <h2 className={styles.monTitle}><Activity size={16} /> Platform Monitor</h2>
              <p className={styles.monSub}>Live platform health — refreshed on demand</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {monitorLastFetched && (
                <span className={styles.monLastUpdated}>
                  Updated {fmtAgo(monitorLastFetched)}
                </span>
              )}
              <button className={styles.refreshBtn} onClick={loadMonitor} disabled={monitorLoading}>
                <RefreshCw size={13} className={monitorLoading ? styles.monSpinning : undefined} />
                Refresh
              </button>
            </div>
          </div>

          {monitorLoading && !md ? (
            <p className={styles.empty} style={{ padding: '48px 0' }}>Loading monitor data…</p>
          ) : (
            <>
              {/* ── Payment health strip ── */}
              {(() => {
                const ph = md?.paymentHealth || {}
                const successColor = ph.successRate == null ? 'rgba(255,255,255,0.28)'
                  : ph.successRate >= 90 ? '#4ade80' : ph.successRate >= 70 ? '#f472b6' : '#f87171'
                return (
                  <div className={styles.monPayStrip}>
                    <div className={styles.monPayMetric}>
                      <span className={styles.monPayLabel}>Revenue today</span>
                      <strong className={styles.monPayValue} style={{ color: '#4ade80' }}>
                        ₹{(ph.revenueToday || 0).toLocaleString('en-IN')}
                      </strong>
                    </div>
                    <div className={styles.monPayDivider} />
                    <div className={styles.monPayMetric}>
                      <span className={styles.monPayLabel}>Payments today</span>
                      <strong className={styles.monPayValue}>
                        {ph.paidToday || 0} paid
                        {ph.failedToday > 0 && <span style={{ color: '#f87171', marginLeft: 8 }}>· {ph.failedToday} failed</span>}
                      </strong>
                    </div>
                    <div className={styles.monPayDivider} />
                    <div className={styles.monPayMetric}>
                      <span className={styles.monPayLabel}>Success rate today</span>
                      <strong className={styles.monPayValue} style={{ color: successColor }}>
                        {ph.successRate != null ? `${ph.successRate}%` : '—'}
                      </strong>
                    </div>
                    <div className={styles.monPayDivider} />
                    <div className={styles.monPayMetric}>
                      <span className={styles.monPayLabel}>Last payment</span>
                      <strong className={styles.monPayValue} style={{ fontSize: 12 }}>
                        {ph.lastPaymentAt ? fmtAgo(ph.lastPaymentAt) : 'No payments yet'}
                      </strong>
                    </div>
                  </div>
                )
              })()}

              {/* ── 5 KPI cards ── */}
              <div className={styles.monKpiRow}>
                <div className={`${styles.monKpiCard} ${styles.monKpiAccent}`}>
                  <div className={styles.monKpiIcon}><Users size={13} /></div>
                  <p className={styles.monKpiValue}>{fmtN(dau.today)}</p>
                  <p className={styles.monKpiLabel}>DAU Today</p>
                  <p className={styles.monKpiSub}>7-day avg: {fmtN(dau.weeklyAvg)}</p>
                </div>

                <div className={styles.monKpiCard}>
                  <div className={styles.monKpiIcon} style={{ background:'rgba(167,139,250,0.12)', borderColor:'rgba(167,139,250,0.2)', color:'#a78bfa' }}>
                    <Database size={13} />
                  </div>
                  <p className={styles.monKpiValue}>{fmtN(usr.total)}</p>
                  <p className={styles.monKpiLabel}>Total Users</p>
                  <p className={styles.monKpiSub}>+{usr.newThisMonth || 0} this month</p>
                </div>

                <div className={`${styles.monKpiCard} ${failedCount > 0 ? styles.monKpiDanger : ''}`}>
                  <div className={styles.monKpiIcon} style={{ background: failedCount > 0 ? 'rgba(248,113,113,0.12)' : 'rgba(34,211,238,0.1)', borderColor: failedCount > 0 ? 'rgba(248,113,113,0.25)' : 'rgba(34,211,238,0.2)', color: failedCount > 0 ? '#f87171' : MON_CYAN }}>
                    <Server size={13} />
                  </div>
                  <p className={styles.monKpiValue} style={{ color: failedCount > 0 ? '#f87171' : undefined }}>
                    {activeJobs} <span className={styles.monKpiValueSub}>active</span>
                  </p>
                  <p className={styles.monKpiLabel}>Upload Queue</p>
                  <p className={styles.monKpiSub} style={{ color: failedCount > 0 ? '#f87171' : undefined }}>
                    {failedCount > 0 ? `⚠ ${failedCount} failed` : 'All healthy'}
                  </p>
                </div>

                <div className={styles.monKpiCard}>
                  <div className={styles.monKpiIcon} style={{ background: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.2)', color: '#4ade80' }}><TrendingUp size={13} /></div>
                  <p className={styles.monKpiValue}>{fmtN(ct.totalViews)}</p>
                  <p className={styles.monKpiLabel}>Total Views</p>
                  <p className={styles.monKpiSub}>{ct.total || 0} titles · {sub.churnRate}% churn</p>
                </div>

                {(() => {
                  const ca = md?.creatorActions || {}
                  const total = (ca.pendingApplications || 0) + (ca.pendingSubmissions || 0) + (ca.pendingReels || 0)
                  const urgent = total > 0
                  return (
                    <div className={`${styles.monKpiCard} ${urgent ? styles.monKpiWarn : ''}`}>
                      <div className={styles.monKpiIcon} style={{ background: urgent ? 'rgba(244,114,182,0.12)' : 'rgba(167,139,250,0.12)', borderColor: urgent ? 'rgba(244,114,182,0.25)' : 'rgba(167,139,250,0.2)', color: urgent ? '#f472b6' : '#a78bfa' }}>
                        <UserCheck size={13} />
                      </div>
                      <p className={styles.monKpiValue} style={{ color: urgent ? '#f472b6' : undefined }}>{total}</p>
                      <p className={styles.monKpiLabel}>Creator Actions</p>
                      <p className={styles.monKpiSub}>
                        {ca.pendingApplications || 0} apps · {ca.pendingSubmissions || 0} content · {ca.pendingReels || 0} reels
                      </p>
                    </div>
                  )
                })()}
              </div>

              {/* ── DAU chart + Upload donut ── */}
              <div className={styles.monChartRow}>
                <div className={styles.monChartCard}>
                  <p className={styles.monChartTitle}><Users size={12} /> Daily Active Users</p>
                  <p className={styles.monChartSub}>Unique logins per day · last 7 days · IST</p>
                  <MonDAUChart data={dau.last7Days} />
                </div>
                <div className={styles.monChartCard}>
                  <p className={styles.monChartTitle}><Server size={12} /> Upload Job Status</p>
                  <p className={styles.monChartSub}>All jobs by current status</p>
                  <MonJobDonut byStatus={uh.byStatus} />
                </div>
              </div>

              {/* ── Subscription trend ── */}
              <div className={styles.monChartCardFull}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16 }}>
                  <div>
                    <p className={styles.monChartTitle}><TrendingUp size={12} /> Subscription Trend</p>
                    <p className={styles.monChartSub}>New subscribers vs estimated churn · last 6 months</p>
                  </div>
                  <div style={{ display:'flex', gap:14, fontFamily:'var(--font-body)', fontSize:11, color:'rgba(255,255,255,0.38)' }}>
                    <span><span style={{ display:'inline-block', width:10, height:8, borderRadius:2, background:MON_CYAN, marginRight:5, verticalAlign:'middle' }}/>New</span>
                    <span><span style={{ display:'inline-block', width:10, height:8, borderRadius:2, background:'#f87171', marginRight:5, verticalAlign:'middle' }}/>Churned</span>
                  </div>
                </div>
                <MonSubTrendChart data={sub.trend} />
              </div>

              {/* ── Top content + Device/Geo ── */}
              <div className={styles.monChartRow}>
                <div className={styles.monChartCard}>
                  <p className={styles.monChartTitle}><Activity size={12} /> Top 5 Content Today</p>
                  <p className={styles.monChartSub}>Most-watched titles in the last 24 hours</p>
                  <MonTopContentList items={md?.topContent} />
                </div>
                <div className={styles.monChartCard}>
                  <div style={{ marginBottom:12 }}>
                    <p className={styles.monChartTitle} style={{ marginBottom:2 }}>Device Split</p>
                    <p className={styles.monChartSub}>How your audience watches · last 7 days</p>
                    <MonDeviceDonut devices={md?.audience?.devices} />
                  </div>
                  <div style={{ paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.06)' }}>
                    <p className={styles.monChartTitle} style={{ marginBottom:2 }}>Top States</p>
                    <p className={styles.monChartSub}>Where your viewers are · last 7 days</p>
                    <MonGeoList states={md?.audience?.states} />
                  </div>
                </div>
              </div>

              {/* ── Jobs lists ── */}
              <div className={styles.monJobsRow}>
                <div className={styles.monChartCard}>
                  <p className={styles.monChartTitle} style={{ color:'#f87171' }}>
                    <AlertCircle size={12} /> Recent Failures
                    {failedCount > 0 && <span className={styles.monBadge}>{failedCount}</span>}
                  </p>
                  {!uh.recentFailed?.length ? (
                    <p className={styles.monEmpty}><span style={{ color:'#4ade80' }}>✓</span> No failed jobs</p>
                  ) : uh.recentFailed.map((j, i) => (
                    <div key={i} className={styles.monJobRow}>
                      <p className={styles.monJobTitle}>{j.title}</p>
                      <p className={styles.monJobError}>{j.error}</p>
                      <p className={styles.monJobAgo}>{fmtAgo(j.ago)}</p>
                    </div>
                  ))}
                </div>
                <div className={styles.monChartCard}>
                  <p className={styles.monChartTitle} style={{ color:MON_CYAN }}>
                    <Activity size={12} /> In Progress
                    {activeJobs > 0 && <span className={styles.monBadgeCyan}>{activeJobs}</span>}
                  </p>
                  {!uh.processing?.length ? (
                    <p className={styles.monEmpty}>Queue is idle</p>
                  ) : uh.processing.map((j, i) => (
                    <div key={i} className={styles.monJobRow}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                        <p className={styles.monJobTitle}>{j.title}</p>
                        <span style={{ fontFamily:'var(--font-body)', fontSize:11, color:MON_CYAN, flexShrink:0 }}>{j.progress}%</span>
                      </div>
                      <div className={styles.monProgressTrack}>
                        <div className={styles.monProgressFill} style={{ width:`${j.progress}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        )
      })()}

    </main>
  )
}
