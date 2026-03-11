import React, { useState, useEffect } from 'react';
import { fetchAirQualityData } from './api';

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

// Barometer arc: 950–1050 hPa, sweeps 180°
function Barometer({ hpa }) {
  const MIN = 950, MAX = 1050;
  const clamped = Math.min(MAX, Math.max(MIN, hpa));
  const fraction = (clamped - MIN) / (MAX - MIN);
  // Arc from 180° to 0° (left to right), needle angle in SVG coords
  const angleDeg = 180 - fraction * 180; // 180=left(low) → 0=right(high)
  const rad = (angleDeg * Math.PI) / 180;
  const cx = 60, cy = 60, r = 44;
  const nx = cx + r * Math.cos(rad);
  const ny = cy - r * Math.sin(rad);

  // Arc path: semicircle from left to right
  const arcColor = hpa < 1000 ? '#60a5fa' : hpa > 1020 ? '#f59e0b' : '#10b981';

  return (
    <svg width="120" height="68" viewBox="0 0 120 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background arc */}
      <path d="M 16 60 A 44 44 0 0 1 104 60" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" fill="none"/>
      {/* Colored fill arc */}
      <path
        d={`M 16 60 A 44 44 0 0 1 ${nx.toFixed(2)} ${ny.toFixed(2)}`}
        stroke={arcColor}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      {/* Needle */}
      <line
        x1={cx} y1={cy}
        x2={nx.toFixed(2)} y2={ny.toFixed(2)}
        stroke="#1e293b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="3" fill="#1e293b"/>
      {/* Labels */}
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
  const [station, setStation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = async () => {
    try {
      const data = await fetchAirQualityData();
      const found = data.stations.find(s => /femman/i.test(s.id));
      setStation(found || null);
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

  if (loading) return <div className="screen center"><div className="spinner"/></div>;
  if (error || !station) return <div className="screen center"><p className="muted">{error || 'Okänt fel'}</p></div>;

  const quality    = getOverallLevel(station.measurements);
  const tempVal    = station.measurements['Temperature']?.value;
  const temp       = tempVal != null ? parseFloat(tempVal).toFixed(1).replace('.', ',') : null;
  const windSpeed  = station.measurements['Wind_Speed']?.value;
  const windDir    = station.measurements['Wind_Direction']?.value;
  const windMs     = windSpeed != null ? parseFloat(windSpeed).toFixed(1).replace('.', ',') : null;
  const compass    = windDir   != null ? degreesToCompass(windDir) : null;
  const rainVal    = station.measurements['Rain']?.value;
  const rain       = rainVal != null ? parseFloat(rainVal).toFixed(1).replace('.', ',') : null;
  const pressureVal = station.measurements['Air_Pressure']?.value;
  const humidity   = station.measurements['Relative_Humidity']?.value;
  const humidityStr = humidity != null ? Math.round(humidity) : null;

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
        <span className="label">Luftkvalitet vid</span>
        <h1 className="station-name">Femman</h1>
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
            <span className="metric-label">Nederbörd / h</span>
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
