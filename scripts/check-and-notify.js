#!/usr/bin/env node
// Fetches air quality at Femman and sends push notifications.
// Triggered by GitHub Actions: every morning at 07:00 (CET) and every hour for deterioration check.
// Required env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, GIST_TOKEN, GIST_ID
// Optional: MORNING_RUN=true (forces notification even if air quality is good)

import webpush from 'web-push';

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_EMAIL,
  GIST_TOKEN,
  GIST_ID,
  MORNING_RUN,
} = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_EMAIL || !GIST_TOKEN || !GIST_ID) {
  console.error('Missing required env vars');
  process.exit(1);
}

webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const AIR_URL = 'https://catalog.goteborg.se/rowstore/dataset/cb541050-487e-4eea-b7b6-640d58f28092/json?station=Femman&_limit=500';
const LEVELS  = ['Bra', 'Okej', 'Måttlig', 'Dålig'];

function evalPM25(v) { if (v < 10) return 0; if (v < 25) return 1; if (v < 50) return 2; return 3; }
function evalNO2(v)  { if (v < 20) return 0; if (v < 40) return 1; if (v < 100) return 2; return 3; }
function evalPM10(v) { if (v < 20) return 0; if (v < 50) return 1; return 2; }

async function fetchLevel() {
  const res  = await fetch(AIR_URL);
  const data = await res.json();
  const results = data.results || [];

  const measurements = {};
  results.forEach(row => {
    const rawValStr = (row.raw_value || '').trim();
    if (rawValStr === '') return;
    const val = parseFloat(rawValStr);
    if (isNaN(val)) return;
    measurements[row.parameter] = val;
  });

  let worst = -1;
  if (measurements['PM2.5'] != null) worst = Math.max(worst, evalPM25(measurements['PM2.5']));
  if (measurements['NO2']   != null) worst = Math.max(worst, evalNO2(measurements['NO2']));
  if (measurements['PM10']  != null) worst = Math.max(worst, evalPM10(measurements['PM10']));
  return worst >= 0 ? worst : null;
}

async function loadGistData() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { Authorization: `token ${GIST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
  const gist = await res.json();
  const content = gist.files['subscriptions.json']?.content;
  if (!content) return { subscriptions: [], lastLevel: null };
  return JSON.parse(content);
}

async function saveGistData(data) {
  await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `token ${GIST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: { 'subscriptions.json': { content: JSON.stringify(data, null, 2) } },
    }),
  });
}

/** Returnerar true om klockan är 22:00–06:59 i Europe/Stockholm-zonen */
function isQuietHour() {
  const hour = parseInt(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
    10
  );
  return hour >= 22 || hour < 7;
}

async function run() {
  const level = await fetchLevel();
  console.log(`Current level: ${level != null ? LEVELS[level] : 'unknown'} (${level})`);

  const gistData = await loadGistData();
  const { subscriptions, lastLevel } = gistData;

  const isMorning = MORNING_RUN === 'true';
  const worsened  = level != null && level >= 2 && (lastLevel == null || level > lastLevel);

  // Timnotiser skickas ej under tysta timmar (22:00–07:00 CET)
  const quiet     = !isMorning && isQuietHour();
  const shouldSend = (isMorning || worsened) && !quiet;

  if (quiet) console.log('Tysta timmar (22:00–07:00 CET) – hoppar över timnotis');

  console.log(`Morning: ${isMorning}, Worsened: ${worsened}, Quiet: ${quiet}, Send: ${shouldSend}`);

  if (!shouldSend || !subscriptions.length) {
    // Update lastLevel even if not sending
    if (level != null) {
      await saveGistData({ subscriptions, lastLevel: level });
    }
    return;
  }

  let title, body;
  if (isMorning) {
    title = `Luftkvalitet Femman: ${level != null ? LEVELS[level] : '–'}`;
    body  = level != null
      ? level === 0 ? 'Luften är bra idag ☀️'
      : level === 1 ? 'Luften är okej idag'
      : level === 2 ? 'Luften är måttlig idag – tänk på det om du är känslig'
      : 'Luften är dålig idag – undvik ansträngande aktiviteter utomhus'
      : 'Mätdata saknas just nu';
  } else {
    title = `Luften har försämrats: ${LEVELS[level]}`;
    body  = level === 2
      ? 'Luftkvaliteten vid Femman är nu måttlig'
      : 'Luftkvaliteten vid Femman är nu dålig – undvik ansträngande aktiviteter utomhus';
  }

  // Declarative Web Push format (iOS 18.4+/iOS 26) — fungerar även med standard SW-baserad push
  const payload = JSON.stringify({
    web_push: 8030,
    notification: {
      title,
      body,
      navigate: 'https://luftfemman.olacarlsson.com',
      silent: false,
    },
  });
  const active = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload, { headers: { 'Content-Type': 'application/notification+json' } });
      active.push(sub);
      console.log('Sent to', sub.endpoint.slice(-20));
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.log('Removed expired subscription');
      } else {
        active.push(sub); // keep on other errors
        console.warn('Send error:', err.statusCode, err.message);
      }
    }
  }

  await saveGistData({ subscriptions: active, lastLevel: level });
  console.log(`Done. Sent to ${active.length}/${subscriptions.length} subscriptions.`);
}

run().catch(e => { console.error(e); process.exit(1); });
