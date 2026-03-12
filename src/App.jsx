import React, { useState, useEffect, useRef } from 'react';
import {
  fetchAirQualityData, fetchRain24h,
  saveSnapshot, loadCachedData, getLocalHistory,
} from './api';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const GIST_TOKEN       = import.meta.env.VITE_GIST_TOKEN || '';
const GIST_ID          = import.meta.env.VITE_GIST_ID || '';

// ── Push-hjälpfunktioner ──────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function saveSubscriptionToGist(sub) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `token ${GIST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: { 'subscriptions.json': { content: JSON.stringify({ subscriptions: [sub] }, null, 2) } },
    }),
  });
  if (!res.ok) throw new Error(`Gist-fel ${res.status}`);
}

async function subscribePush() {
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const pm = navigator.pushManager || window.pushManager;
  if (pm) {
    const existing = await pm.getSubscription();
    if (existing) return existing;
    return await pm.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  if (!navigator.serviceWorker) throw new Error('Inget pushManager tillgängligt');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

// ── Historik & trend ──────────────────────────────────────────────────────────

/** Returnerar tidserie {time, value}[] sorterad äldst→nyast, senaste 25h */
function getParamSeries(history, stationId, param) {
  const cutoff = Date.now() - 25 * 60 * 60 * 1000;
  return history
    .filter(snap => snap.time >= cutoff)
    .map(snap => {
      const st = snap.stations?.find(s => s.id === stationId);
      const v = st?.measurements[param]?.value;
      return v != null ? { time: snap.time, value: v } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

/** Jämför senaste vs ~1h sedan; returnerar {arrow, color} eller null */
function computeTrend(series) {
  if (series.length < 2) return null;
  const latest = series[series.length - 1].value;
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const older = series.filter(d => d.time <= hourAgo);
  const ref = older.length ? older[older.length - 1].value : series[0].value;
  const diff = latest - ref;
  if (Math.abs(diff) < 2) return { arrow: '→', color: '#94a3b8' };
  return diff > 0
    ? { arrow: '↑', color: '#ef4444' }
    : { arrow: '↓', color: '#22c55e' };
}

// ── Utvärdering & nivåer ──────────────────────────────────────────────────────

function evalPM25(v) { if (v < 10) return 0; if (v < 25) return 1; if (v < 50) return 2; return 3; }
function evalNO2(v)  { if (v < 20) return 0; if (v < 40) return 1; if (v < 100) return 2; return 3; }
function evalPM10(v) { if (v < 20) return 0; if (v < 50) return 1; return 2; }

const EVAL_FN    = { 'PM2.5': evalPM25, 'NO2': evalNO2, 'PM10': evalPM10 };
const WHO_LIMITS = { 'PM2.5': 15, 'NO2': 25, 'PM10': 45 };

const LEVELS = [
  { label: 'Bra',     level: 0, bg: '#dcfce7', text: '#14532d', bar: '#4ade80' },
  { label: 'Okej',    level: 1, bg: '#ecfccb', text: '#365314', bar: '#a3e635' },
  { label: 'Måttlig', level: 2, bg: '#fef9c3', text: '#713f12', bar: '#facc15' },
  { label: 'Dålig',   level: 3, bg: '#fee2e2', text: '#7f1d1d', bar: '#f87171' },
];

function getOverallLevel(measurements) {
  let worst = -1;
  const pm25 = measurements['PM2.5']?.value;
  const no2  = measurements['NO2']?.value;
  const pm10 = measurements['PM10']?.value;
  if (pm25 != null) worst = Math.max(worst, evalPM25(pm25));
  if (no2  != null) worst = Math.max(worst, evalNO2(no2));
  if (pm10 != null) worst = Math.max(worst, evalPM10(pm10));
  return worst >= 0 ? LEVELS[worst] : null;
}

// ── Ikoner ────────────────────────────────────────────────────────────────────

function BellIcon({ on }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      {on && <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444"/>}
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}

// ── Vertikala skalan ──────────────────────────────────────────────────────────

function VerticalScale({ currentLevel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 72, alignSelf: 'stretch' }}>
      {LEVELS.map((l) => {
        const active = l.level === currentLevel;
        return (
          <div key={l.level} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: active ? 14 : 10, borderRadius: 99, alignSelf: 'stretch',
              background: active ? l.bar : '#e2e8f0', transition: 'all 0.3s', flexShrink: 0,
            }} />
            <span style={{
              fontSize: 10, fontWeight: active ? 700 : 400,
              color: active ? l.text : '#c0ccd8',
              letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1,
            }}>
              {l.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Sparkline (SVG) ───────────────────────────────────────────────────────────

function MiniChart({ series, param }) {
  if (!series || series.length < 2) return <div style={{ height: 36 }} />;
  const who = WHO_LIMITS[param];
  const W = 280, H = 36;
  const times  = series.map(d => d.time);
  const values = series.map(d => d.value);
  const minT = Math.min(...times), maxT = Math.max(...times);
  const maxV = Math.max(...values, who ? who * 1.2 : 1, 1);

  const px = t => maxT === minT ? W / 2 : ((t - minT) / (maxT - minT)) * W;
  const py = v => H - (v / maxV) * H;

  const pathD = series
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${px(d.time).toFixed(1)},${py(d.value).toFixed(1)}`)
    .join(' ');

  const whoY = who != null ? py(who) : null;

  return (
    <svg
      width="100%" height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 10, overflow: 'visible' }}
    >
      {whoY != null && (
        <line
          x1="0" y1={whoY} x2={W} y2={whoY}
          stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="5,4" opacity="0.7"
        />
      )}
      <path
        d={pathD}
        stroke="#60a5fa" strokeWidth="2" fill="none"
        strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Barometer ─────────────────────────────────────────────────────────────────

function Barometer({ hpa }) {
  const MIN = 950, MAX = 1050;
  const clamped = Math.min(MAX, Math.max(MIN, hpa));
  const fraction = (clamped - MIN) / (MAX - MIN);
  const angleDeg = 180 - fraction * 180;
  const rad = (angleDeg * Math.PI) / 180;
  const cx = 60, cy = 60, r = 44;
  const nx = cx + r * Math.cos(rad);
  const ny = cy - r * Math.sin(rad);
  const arcColor = hpa < 1000 ? '#60a5fa' : hpa > 1020 ? '#f59e0b' : '#10b981';
  return (
    <svg width="120" height="68" viewBox="0 0 120 68" fill="none">
      <path d="M 16 60 A 44 44 0 0 1 104 60" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" fill="none"/>
      <path d={`M 16 60 A 44 44 0 0 1 ${nx.toFixed(2)} ${ny.toFixed(2)}`} stroke={arcColor} strokeWidth="6" strokeLinecap="round" fill="none"/>
      <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="3" fill="#1e293b"/>
      <text x="8"  y="68" fontSize="8" fill="#94a3b8" fontFamily="Inter,sans-serif">Lågt</text>
      <text x="86" y="68" fontSize="8" fill="#94a3b8" fontFamily="Inter,sans-serif">Högt</text>
    </svg>
  );
}

// ── Hjälpfunktioner ───────────────────────────────────────────────────────────

function degreesToCompass(deg) {
  const dirs = ['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSV','SV','VSV','V','VNV','NV','NNV'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function latestMeasuredTime(measurements) {
  const dates = Object.values(measurements)
    .map(m => m.time ? new Date(m.time) : null)
    .filter(d => d && !isNaN(d));
  if (!dates.length) return null;
  return new Date(Math.max(...dates));
}

function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [stations, setStations]     = useState([]);
  const [stationIdx, setStationIdx] = useState(0);
  const [rain24h, setRain24h]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [offline, setOffline]       = useState(false);
  const [history, setHistory]       = useState(() => getLocalHistory());
  const [shareMsg, setShareMsg]     = useState('');
  const [pushState, setPushState]   = useState('idle'); // idle | pending | on | error
  const [pushMsg, setPushMsg]       = useState('');
  const touchX = useRef(null);

  const load = async (isFirst = false) => {
    try {
      const [data, rainSum] = await Promise.all([
        fetchAirQualityData(),
        fetchRain24h().catch(() => null),
      ]);
      // Behåll bara stationer med luftkvalitetsparametrar
      const aqStations = data.stations.filter(
        s => s.measurements['PM2.5'] || s.measurements['NO2'] || s.measurements['PM10']
      );
      if (!aqStations.length) throw new Error('Inga luftkvalitetsstationer hittades');
      saveSnapshot(aqStations, rainSum);
      setStations(aqStations);
      setRain24h(rainSum);
      setOffline(false);
      setHistory(getLocalHistory());
    } catch {
      // Nätverksfel – försök cachen
      const cached = loadCachedData();
      if (cached?.stations?.length) {
        if (isFirst) {
          setStations(cached.stations);
          setRain24h(cached.rain24h ?? null);
          setHistory(getLocalHistory());
        }
        setOffline(true);
      }
    } finally {
      if (isFirst) setLoading(false);
    }
  };

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Klämm stationIdx om antal stationer minskar
  useEffect(() => {
    if (stations.length > 0 && stationIdx >= stations.length) {
      setStationIdx(stations.length - 1);
    }
  }, [stations.length]);

  // Registrera service worker + kolla push-prenumeration
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        if (sub) setPushState('on');
      }).catch(e => console.error('SW reg failed:', e));
    }
  }, []);

  const handlePushToggle = async () => {
    if (pushState === 'on') return;
    if (!VAPID_PUBLIC_KEY || !GIST_TOKEN || !GIST_ID) {
      setPushMsg('Notiser ej konfigurerade'); setPushState('error'); return;
    }
    if ('Notification' in window && Notification.permission === 'denied') {
      setPushState('error'); setPushMsg('Blockerat i inställningar – tillåt notiser för sajten'); return;
    }
    try {
      if ('Notification' in window && Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setPushState('error'); setPushMsg(`Notiser nekades (${perm})`); return;
        }
      }
      const sub = await subscribePush();
      setPushState('pending');
      await saveSubscriptionToGist(sub.toJSON());
      setPushState('on'); setPushMsg('Notiser aktiverade!');
    } catch (e) {
      const perm = 'Notification' in window ? Notification.permission : 'n/a';
      setPushState('error'); setPushMsg(`${e.message || String(e)} (perm: ${perm})`);
    }
  };

  const handleShare = async (stationName, qualityLabel) => {
    const text = `Luftkvalitet vid ${stationName}: ${qualityLabel} just nu`;
    const url  = 'https://luftfemman.olacarlsson.com';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'LuftGbg', text, url });
      } else {
        await navigator.clipboard.writeText(`${text} – ${url}`);
        setShareMsg('Kopierad!');
        setTimeout(() => setShareMsg(''), 2000);
      }
    } catch { /* avbrutet av användare */ }
  };

  // Swipe-navigation
  const handleTouchStart = e => { touchX.current = e.touches[0].clientX; };
  const handleTouchEnd   = e => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx < -50) setStationIdx(i => Math.min(i + 1, stations.length - 1));
    if (dx >  50) setStationIdx(i => Math.max(i - 1, 0));
  };

  if (loading) return <div className="screen center"><div className="spinner"/></div>;
  if (!stations.length) return (
    <div className="screen center">
      <p className="muted">{offline ? 'Offline och ingen cache tillgänglig' : 'Ingen data tillgänglig'}</p>
    </div>
  );

  const st          = stations[Math.min(stationIdx, stations.length - 1)];
  const quality     = getOverallLevel(st.measurements);
  const tempVal     = st.measurements['Temperature']?.value;
  const temp        = tempVal != null ? parseFloat(tempVal).toFixed(1).replace('.', ',') : null;
  const windSpeed   = st.measurements['Wind_Speed']?.value;
  const windDir     = st.measurements['Wind_Direction']?.value;
  const windMs      = windSpeed != null ? parseFloat(windSpeed).toFixed(1).replace('.', ',') : null;
  const compass     = windDir   != null ? degreesToCompass(windDir) : null;
  const rain        = rain24h   != null ? parseFloat(rain24h).toFixed(1).replace('.', ',') : null;
  const pressureVal = st.measurements['Air_Pressure']?.value;
  const humidity    = st.measurements['Relative_Humidity']?.value;
  const humidityStr = humidity  != null ? Math.round(humidity) : null;

  const measured = latestMeasuredTime(st.measurements);
  const today    = new Date();
  const dateStr  = cap(today.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }));
  const timeStr  = measured
    ? measured.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    : null;

  const isStandalone = 'Notification' in window &&
    (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);

  return (
    <div
      className="screen column"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >

      {/* Offline-banner */}
      {offline && (
        <div className="offline-banner">Offline – visar senast kända data</div>
      )}

      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', maxWidth: 360 }}>
          <div>
            <span className="label">Luftkvalitet vid</span>
            <h1 className="station-name">{st.name}</h1>
          </div>
          <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
            {/* Dela-knapp */}
            <button
              onClick={() => handleShare(st.name, quality?.label || '–')}
              title="Dela"
              className="icon-btn"
              style={{ color: shareMsg ? '#22c55e' : '#94a3b8' }}
            >
              {shareMsg
                ? <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{shareMsg}</span>
                : <ShareIcon />}
            </button>

            {/* Klocka (standalone) */}
            {isStandalone && (
              <button
                onClick={handlePushToggle}
                disabled={pushState === 'pending' || pushState === 'on'}
                title={pushState === 'on' ? 'Notiser aktiverade' : 'Aktivera notiser'}
                className="icon-btn"
                style={{
                  color: pushState === 'on' ? '#22c55e' : pushState === 'error' ? '#ef4444' : '#94a3b8',
                  opacity: pushState === 'pending' ? 0.5 : 1,
                  cursor: pushState === 'on' ? 'default' : 'pointer',
                }}
              >
                <BellIcon on={pushState === 'on'} />
              </button>
            )}
          </div>
        </div>
        {pushMsg && (
          <span style={{ fontSize: 11, color: pushState === 'error' ? '#ef4444' : '#22c55e', marginTop: 2 }}>
            {pushMsg}
          </span>
        )}
      </div>

      {/* Statusbricka + vertikal skala */}
      <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360, marginBottom: 16 }}>
        {quality ? (
          <div className="status-card" style={{ backgroundColor: quality.bg, marginBottom: 0, flex: 1 }}>
            <span className="status-word" style={{ color: quality.text }}>{quality.label}</span>
          </div>
        ) : (
          <div className="status-card no-data" style={{ marginBottom: 0, flex: 1 }}>
            <span className="status-word muted">–</span>
          </div>
        )}
        {quality && <VerticalScale currentLevel={quality.level} />}
      </div>

      {/* Luftkvalitetstiles med sparklines */}
      <div className="pollution-grid">
        {['PM2.5', 'NO2', 'PM10'].map(param => {
          const m = st.measurements[param];
          if (!m) return null;
          const series  = getParamSeries(history, st.id, param);
          const trend   = computeTrend(series);
          const level   = EVAL_FN[param](m.value);
          const lvl     = LEVELS[Math.min(level, LEVELS.length - 1)];
          const valStr  = m.value.toFixed(1).replace('.', ',');
          const hasData = series.length >= 2;

          return (
            <div key={param} className="pollution-tile">
              <div className="pollution-header">
                <span className="metric-label">{param}</span>
                {trend && (
                  <span className="trend-arrow" style={{ color: trend.color }}>
                    {trend.arrow}
                  </span>
                )}
              </div>
              <div className="metric-value" style={{ marginTop: 4 }}>
                <span className="metric-num" style={{ fontSize: 32, color: lvl.text }}>{valStr}</span>
                <span className="metric-unit">µg/m³</span>
              </div>
              {hasData
                ? <MiniChart series={series} param={param} />
                : <p className="sparkline-hint">Graf visas efter fler mätningar</p>
              }
            </div>
          );
        })}
      </div>

      {/* Vädermetrik-grid */}
      <div className="metrics-grid">
        {temp != null && (
          <div className="metric-tile">
            <span className="metric-label">Temperatur</span>
            <div className="metric-value">
              <span className="metric-num">{temp}</span>
              <span className="metric-unit">°C</span>
            </div>
          </div>
        )}
        {humidityStr != null && (
          <div className="metric-tile">
            <span className="metric-label">Luftfuktighet</span>
            <div className="metric-value">
              <span className="metric-num">{humidityStr}</span>
              <span className="metric-unit">%</span>
            </div>
          </div>
        )}
        {windMs != null && (
          <div className="metric-tile">
            <span className="metric-label">Vind</span>
            <div className="metric-value">
              <span className="metric-num">{windMs}</span>
              <span className="metric-unit">m/s</span>
            </div>
            {compass && <span className="metric-compass">{compass}</span>}
          </div>
        )}
        {rain != null && (
          <div className="metric-tile">
            <span className="metric-label">Nederbörd 24 h</span>
            <div className="metric-value">
              <span className="metric-num">{rain}</span>
              <span className="metric-unit">mm</span>
            </div>
          </div>
        )}
      </div>

      {/* Barometer */}
      {pressureVal != null && (
        <div className="barometer-tile">
          <span className="metric-label">Lufttryck</span>
          <Barometer hpa={pressureVal} />
          <span className="baro-value">
            {Math.round(pressureVal)}<span className="baro-unit"> hPa</span>
          </span>
        </div>
      )}

      {/* Datum + tid */}
      <div className="datetime">
        <span className="date-text">{dateStr}</span>
        {timeStr && <span className="time-text">Mätt kl&nbsp;{timeStr}</span>}
      </div>

      {/* Stations-navigationspunkter */}
      {stations.length > 1 && (
        <div className="station-dots">
          {stations.map((s, i) => (
            <button
              key={s.id}
              className={`station-dot${i === stationIdx ? ' active' : ''}`}
              onClick={() => setStationIdx(i)}
              aria-label={s.name}
            />
          ))}
        </div>
      )}

    </div>
  );
}
