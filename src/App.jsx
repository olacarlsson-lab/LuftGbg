import React, { useState, useEffect, useRef } from 'react';
import { fetchAirQualityData, fetchRain24h } from './api';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const GIST_TOKEN       = import.meta.env.VITE_GIST_TOKEN || '';
const GIST_ID          = import.meta.env.VITE_GIST_ID || '';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function saveSubscriptionToGist(sub) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `token ${GIST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        'subscriptions.json': {
          content: JSON.stringify({ subscriptions: [sub] }, null, 2),
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gist-fel ${res.status}`);
}

async function subscribePush() {
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const navPM = navigator.pushManager;
  const winPM = window.pushManager;
  const navSW = navigator.serviceWorker;

  // Declarative Web Push: prova navigator.pushManager och window.pushManager
  const pm = navPM || winPM;
  if (pm) {
    const existing = await pm.getSubscription();
    if (existing) return existing;
    return await pm.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }

  // Standard Web Push via service worker (äldre iOS, desktop)
  if (!navSW) throw new Error(`Inget PM: nav=${!!navPM} win=${!!winPM} sw=${!!navSW}`);
  const reg = await navSW.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

function BellIcon({ on }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      {on && <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444"/>}
    </svg>
  );
}

const LEVELS = [
  { label: 'Bra',     level: 0, bg: '#dcfce7', text: '#14532d', bar: '#4ade80' },
  { label: 'Okej',    level: 1, bg: '#ecfccb', text: '#365314', bar: '#a3e635' },
  { label: 'Måttlig', level: 2, bg: '#fef9c3', text: '#713f12', bar: '#facc15' },
  { label: 'Dålig',   level: 3, bg: '#fee2e2', text: '#7f1d1d', bar: '#f87171' },
];

function VerticalScale({ currentLevel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 72, alignSelf: 'stretch' }}>
      {LEVELS.map((l) => {
        const active = l.level === currentLevel;
        return (
          <div key={l.level} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: active ? 14 : 10,
              borderRadius: 99,
              alignSelf: 'stretch',
              background: active ? l.bar : '#e2e8f0',
              transition: 'all 0.3s',
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 10,
              fontWeight: active ? 700 : 400,
              color: active ? l.text : '#c0ccd8',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              lineHeight: 1,
            }}>
              {l.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function evalPM25(v) { if (v < 10) return 0; if (v < 25) return 1; if (v < 50) return 2; return 3; }
function evalNO2(v)  { if (v < 20) return 0; if (v < 40) return 1; if (v < 100) return 2; return 3; }
function evalPM10(v) { if (v < 20) return 0; if (v < 50) return 1; return 2; }

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

function degreesToCompass(deg) {
  const dirs = ['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSV','SV','VSV','V','VNV','NV','NNV'];
  return dirs[Math.round(deg / 22.5) % 16];
}

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
    <svg width="120" height="68" viewBox="0 0 120 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M 16 60 A 44 44 0 0 1 104 60" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" fill="none"/>
      <path d={`M 16 60 A 44 44 0 0 1 ${nx.toFixed(2)} ${ny.toFixed(2)}`} stroke={arcColor} strokeWidth="6" strokeLinecap="round" fill="none"/>
      <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="3" fill="#1e293b"/>
      <text x="8"  y="68" fontSize="8" fill="#94a3b8" fontFamily="Inter,sans-serif">Lågt</text>
      <text x="86" y="68" fontSize="8" fill="#94a3b8" fontFamily="Inter,sans-serif">Högt</text>
    </svg>
  );
}

function latestMeasuredTime(measurements) {
  const dates = Object.values(measurements)
    .map(m => m.time ? new Date(m.time) : null)
    .filter(d => d && !isNaN(d));
  if (!dates.length) return null;
  return new Date(Math.max(...dates));
}

function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

export default function App() {
  const [station, setStation]   = useState(null);
  const [rain24h, setRain24h]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [pushState, setPushState] = useState('idle'); // idle | pending | on | error
  const [pushMsg, setPushMsg]   = useState('');

  const load = async () => {
    try {
      const [data, rainSum] = await Promise.all([
        fetchAirQualityData(),
        fetchRain24h(),
      ]);
      const found = data.stations.find(s => /femman/i.test(s.id));
      setStation(found || null);
      setRain24h(rainSum);
      setError(found ? null : 'Hittade inte Femman-stationen');
    } catch {
      setError('Kunde inte ladda luftdata');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Register service worker
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
      setPushMsg('Notiser ej konfigurerade');
      setPushState('error');
      return;
    }
    if ('Notification' in window && Notification.permission === 'denied') {
      setPushState('error');
      setPushMsg('Blockerat i inställningar – tillåt notiser för sajten');
      return;
    }
    try {
      if ('Notification' in window && Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setPushState('error');
          setPushMsg(`Notiser nekades (${perm})`);
          return;
        }
      }
      const sub = await subscribePush();
      setPushState('pending');
      await saveSubscriptionToGist(sub.toJSON());
      setPushState('on');
      setPushMsg('Notiser aktiverade!');
    } catch (e) {
      const perm = 'Notification' in window ? Notification.permission : 'n/a';
      setPushState('error');
      setPushMsg(`${e.message || String(e)} (perm: ${perm})`);
    }
  };

  if (loading) return <div className="screen center"><div className="spinner"/></div>;
  if (error || !station) return <div className="screen center"><p className="muted">{error || 'Okänt fel'}</p></div>;

  const quality     = getOverallLevel(station.measurements);
  const tempVal     = station.measurements['Temperature']?.value;
  const temp        = tempVal != null ? parseFloat(tempVal).toFixed(1).replace('.', ',') : null;
  const windSpeed   = station.measurements['Wind_Speed']?.value;
  const windDir     = station.measurements['Wind_Direction']?.value;
  const windMs      = windSpeed != null ? parseFloat(windSpeed).toFixed(1).replace('.', ',') : null;
  const compass     = windDir   != null ? degreesToCompass(windDir) : null;
  const rain        = rain24h   != null ? parseFloat(rain24h).toFixed(1).replace('.', ',') : null;
  const pressureVal = station.measurements['Air_Pressure']?.value;
  const humidity    = station.measurements['Relative_Humidity']?.value;
  const humidityStr = humidity  != null ? Math.round(humidity) : null;

  const measured = latestMeasuredTime(station.measurements);
  const today    = new Date();
  const dateStr  = cap(today.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }));
  const timeStr  = measured
    ? measured.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="screen column">

      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', maxWidth: 360 }}>
          <div>
            <span className="label">Luftkvalitet vid</span>
            <h1 className="station-name">Femman</h1>
          </div>
          {'Notification' in window && (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) && (
            <button
              onClick={handlePushToggle}
              disabled={pushState === 'pending' || pushState === 'on'}
              title={pushState === 'on' ? 'Notiser aktiverade' : 'Aktivera notiser'}
              style={{
                background: 'none', border: 'none', cursor: pushState === 'on' ? 'default' : 'pointer',
                color: pushState === 'on' ? '#22c55e' : pushState === 'error' ? '#ef4444' : '#94a3b8',
                padding: '4px', marginTop: 6, borderRadius: 8,
                opacity: pushState === 'pending' ? 0.5 : 1,
              }}
            >
              <BellIcon on={pushState === 'on'} />
            </button>
          )}
        </div>
        {pushMsg && (
          <span style={{ fontSize: 11, color: pushState === 'error' ? '#ef4444' : '#22c55e', marginTop: 2 }}>
            {pushMsg}
          </span>
        )}
      </div>

      {/* Air quality status + vertical scale */}
      <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360, marginBottom: 36 }}>
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

      {/* Metrics grid */}
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

      {/* Date + time */}
      <div className="datetime">
        <span className="date-text">{dateStr}</span>
        {timeStr && <span className="time-text">Mätt kl&nbsp;{timeStr}</span>}
      </div>

    </div>
  );
}
