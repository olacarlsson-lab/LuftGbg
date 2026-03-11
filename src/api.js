export const fetchAirQualityData = async () => {
    const url = 'https://catalog.goteborg.se/rowstore/dataset/cb541050-487e-4eea-b7b6-640d58f28092/json?station=Femman&_limit=500';

    try {
        const response = await fetch(url);
        const data = await response.json();

        const results = data.results || [];
        const stationsMap = new Map();
        const parametersSet = new Set();

        // Collect all rain readings per station for 24h sum
        const rainReadings = new Map(); // stationId -> [{value, time}]

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

                // Combine date + time into a full ISO-like string
                const fullTime = (row.date && row.time)
                    ? `${row.date}T${row.time}`
                    : (row.time || null);

                stationsMap.get(st).measurements[param] = {
                    value: val,
                    unit: row.unit_code,
                    time: fullTime
                };

                parametersSet.add(param);

                // Collect all rain readings with timestamps
                if (/^rain$/i.test(param)) {
                    if (!rainReadings.has(st)) rainReadings.set(st, []);
                    rainReadings.get(st).push({ value: val, time: fullTime });
                }
            }
        });

        // Calculate 24h rain sum per station
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        stationsMap.forEach((station, id) => {
            const readings = rainReadings.get(id) || [];
            const last24h = readings.filter(r => r.time && new Date(r.time).getTime() >= cutoff);
            station.rain24h = last24h.length > 0
                ? last24h.reduce((sum, r) => sum + r.value, 0)
                : null;
        });

        return {
            stations: Array.from(stationsMap.values()),
            parameters: Array.from(parametersSet).sort()
        };
    } catch (error) {
        console.error("Error fetching data:", error);
        throw error;
    }
};
