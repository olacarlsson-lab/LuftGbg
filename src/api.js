// Hämtar alla stationer (inget ?station=-filter)
export const fetchAirQualityData = async () => {
    const url = 'https://catalog.goteborg.se/rowstore/dataset/cb541050-487e-4eea-b7b6-640d58f28092/json?_limit=1000';

    const response = await fetch(url);
    const data = await response.json();

    const results = data.results || [];
    const stationsMap = new Map();
    const parametersSet = new Set();

    results.forEach(row => {
        const st = row.station;
        const param = row.parameter;

        const lat = parseFloat(row.latitude_wgs84);
        const lon = parseFloat(row.longitude_wgs84);
        if (!isFinite(lat) || !isFinite(lon)) return;

        const rawValStr = (row.raw_value || '').trim();
        let val = null;
        if (rawValStr !== '') {
            const parsed = parseFloat(rawValStr);
            if (!isNaN(parsed)) val = parsed;
        }

        if (val !== null) {
            if (!stationsMap.has(st)) {
                stationsMap.set(st, {
                    id: st,
                    name: st.replaceAll('_', ' '),
                    lat,
                    lon,
                    measurements: {}
                });
            }

            const fullTime = (row.date && row.time)
                ? `${row.date}T${row.time}`
                : (row.time || null);

            stationsMap.get(st).measurements[param] = {
                value: val,
                unit: row.unit_code,
                time: fullTime
            };

            parametersSet.add(param);
        }
    });

    return {
        stations: Array.from(stationsMap.values()),
        parameters: Array.from(parametersSet).sort()
    };
};

// ── localStorage: historik & cache ────────────────────────────────────────────

const HISTORY_KEY = 'luftgbg_history_v1';
const CACHE_KEY   = 'luftgbg_cache_v1';
const HISTORY_TTL = 25 * 60 * 60 * 1000; // 25h

export function saveSnapshot(stations, rain24h) {
    const now = Date.now();

    // Offline-cache
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ stations, rain24h, time: now }));
    } catch {}

    // Historik-ringbuffer
    let history = [];
    try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch {}
    history = history.filter(e => now - e.time < HISTORY_TTL);
    history.push({ time: now, stations });
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
        // Lagringen full – behåll de 20 senaste
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-20))); } catch {}
    }
}

export function loadCachedData() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function getLocalHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch { return []; }
}

// ── SMHI nederbörd ─────────────────────────────────────────────────────────────

// SMHI station "Göteborg A" (71420) — parameter 7 = nederbördsmängd summa 1h
const SMHI_RAIN_URL = 'https://opendata-download-metobs.smhi.se/api/version/latest/parameter/7/station/71420/period/latest-months/data.json';

export const fetchRain24h = async () => {
    const response = await fetch(SMHI_RAIN_URL);
    const data = await response.json();
    const values = data.value || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const last24h = values.filter(v => v.date >= cutoff);
    if (!last24h.length) return null;
    return last24h.reduce((sum, v) => sum + parseFloat(v.value), 0);
};
