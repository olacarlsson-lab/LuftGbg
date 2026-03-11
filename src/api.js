export const fetchAirQualityData = async () => {
    const url = 'https://catalog.goteborg.se/rowstore/dataset/cb541050-487e-4eea-b7b6-640d58f28092/json?station=Femman&_limit=500';

    try {
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
                        name: st.replace('_', ' '),
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
    } catch (error) {
        console.error("Error fetching air quality data:", error);
        throw error;
    }
};

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
