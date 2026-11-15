import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MISSIONS } from '../data/missionsData.js';
import { SCIENCE_POIS } from '../data/sciencePoisData.js';
import { getElevationAtPoint, getSlopeAtPoint } from '../data/terrainElevationData.js';
import { generateDensePath, calculateRouteMetrics } from '../services/pathSolver.js';
import { calculatePlssConsumption } from '../services/plssCalculator.js';
import { assessRoute } from '../services/assess.js';
import { canvasToMarsCoords, pixelsToMeters, pixelsToKm } from '../services/coordinates.js';
import { authSaveTraverse } from '../services/aresApi.js';
import { toast } from '../lib/toast.js';

const Ctx = createContext(null);
const KEY = 'ares:v2';
export const HAZARD_KINDS = {
  boulders: { label: 'Boulder field', hint: 'Rocks too large to step over', r: 40 },
  slope: { label: 'Slope failure', hint: 'Loose regolith, active slumping', r: 34 },
  dust: { label: 'Dust devil track', hint: 'Visibility and suit abrasion risk', r: 46 }
};

const seed = () => Object.fromEntries(MISSIONS.map((m) => [m.id, m.defaultWaypoints.map((w) => ({ ...w, elevation: getElevationAtPoint(m.id, w.x, w.y) }))]));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

export function MissionProvider({ children }) {
  const saved = useRef(load()).current;
  const [missionId, setMissionIdRaw] = useState(MISSIONS.some((m) => m.id === saved.missionId) ? saved.missionId : 'jezero');
  const [routeMode, setRouteMode] = useState(['safe', 'direct', 'science'].includes(saved.routeMode) ? saved.routeMode : 'safe');
  const [wpMap, setWpMap] = useState(() => ({ ...seed(), ...(saved.wpMap || {}) }));
  const [hzMap, setHzMap] = useState(() => Object.fromEntries(Object.entries(saved.hzMap || {}).map(([k, v]) => [k, v.map((h) => ({ ...h, validated: true }))])));
  const [log, setLog] = useState([]);
  const [selectedPoiId, setSelectedPoiId] = useState(null);
  const timers = useRef([]);

  const mission = MISSIONS.find((m) => m.id === missionId);
  const waypoints = wpMap[missionId];
  const hazards = hzMap[missionId] || [];
  const pois = useMemo(() => SCIENCE_POIS.filter((p) => p.missionId === missionId), [missionId]);
  const routing = useMemo(() => hazards.filter((h) => h.validated), [hazards]);

  const path = useMemo(() => generateDensePath(waypoints, missionId, routeMode, routing), [waypoints, missionId, routeMode, routing]);
  const metrics = useMemo(() => calculateRouteMetrics(path.points), [path]);
  const endPlss = useMemo(() => calculatePlssConsumption(metrics, 1, path.points, mission.dustTau), [metrics, path.points, mission.dustTau]);
  const assessment = useMemo(() => assessRoute({ metrics, points: path.points, hazards, mission, endPlss, pois }), [metrics, path, hazards, mission, endPlss, pois]);
  const stations = useMemo(() => path.stations.map((s, i) => {
    const p = path.points[s.index];
    return { ...s.wp, n: i, t: p.t, km: (metrics.distanceKm * p.t), etaMin: Math.round(metrics.estimatedTimeMin * p.t), slope: p.slope, elevation: p.elevation, o2: calculatePlssConsumption(metrics, p.t, path.points, mission.dustTau).o2RemainingPercent };
  }), [path, metrics, mission.dustTau]);

  const latest = useRef({});
  latest.current = { path, metrics, waypoints, routeMode, routing, missionId, assessment, mission };

  useEffect(() => {
    const id = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ missionId, routeMode, wpMap, hzMap })); } catch {} }, 300);
    return () => clearTimeout(id);
  }, [missionId, routeMode, wpMap, hzMap]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const savePlan = async () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ missionId, routeMode, wpMap, hzMap }));
    } catch {}

    // Check if user is authenticated with token for PostgreSQL persistence
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('ares_auth_token') : null;
    if (token) {
      try {
        const L = latest.current;
        const pts = L.path.points || [];
        const startPt = pts[0] || { x: 400, y: 300 };
        const endPt = pts[pts.length - 1] || startPt;
        const startGeo = canvasToMarsCoords(L.mission, startPt.x, startPt.y);
        const endGeo = canvasToMarsCoords(L.mission, endPt.x, endPt.y);

        // Find hazards near the path points
        const nearbyHazards = (L.routing || []).map((h) => {
          const hGeo = canvasToMarsCoords(L.mission, h.x, h.y);
          // Calculate approximate distance to closest route point
          let minDistM = 999999;
          for (const pt of pts) {
            const d = Math.hypot(pt.x - h.x, pt.y - h.y);
            if (d < minDistM) minDistM = d;
          }
          return {
            hazard_name: HAZARD_KINDS[h.kind]?.label || 'Martian Hazard',
            category: h.kind || 'terrain',
            severity: h.kind === 'dust' ? 3 : 4,
            lat: hGeo.lat,
            lon: hGeo.lon,
            distance_from_path_km: +pixelsToKm(minDistM).toFixed(3),
            detail: `Radius ${pixelsToMeters(h.r || 40).toFixed(0)}m, detected along ${L.mission.name} traverse`
          };
        });

        // Sample waypoints
        const sampledWps = (L.waypoints || []).map((w) => {
          const geo = canvasToMarsCoords(L.mission, w.x, w.y);
          return { name: w.name, lat: geo.lat, lon: geo.lon, elevation: w.elevation };
        });

        await authSaveTraverse({
          mission_id: L.missionId,
          route_name: `${L.mission.name} Plan v${1 + (L.routing || []).length}`,
          route_mode: L.routeMode,
          decision: L.assessment?.state === 'go' ? 'GO' : L.assessment?.state === 'caution' ? 'CAUTION' : 'NO_GO',
          start_lat: startGeo.lat,
          start_lon: startGeo.lon,
          end_lat: endGeo.lat,
          end_lon: endGeo.lon,
          distance_km: +L.metrics.distanceKm.toFixed(3),
          estimated_time_min: L.metrics.estimatedTimeMin,
          max_slope_deg: +L.metrics.maxSlope.toFixed(2),
          safety_score: L.assessment?.state === 'go' ? 95.0 : L.assessment?.state === 'caution' ? 70.0 : 40.0,
          o2_used_liters: 0.0,
          waypoints: sampledWps,
          nearby_hazards: nearbyHazards
        });
        toast('Plan & path hazards saved to PostgreSQL database & device', 'ok');
        return;
      } catch (err) {
        console.error('Error recording to PostgreSQL:', err);
      }
    }

    toast('Plan saved on this device. Sign in to sync with PostgreSQL.', 'ok');
  };

  const setWps = (fn) => setWpMap((m) => ({ ...m, [missionId]: fn(m[missionId]) }));
  const setMissionId = (id) => { setMissionIdRaw(id); setSelectedPoiId(null); setLog([]); };

  const addPoiToRoute = (poi) => {
    if (waypoints.some((w) => w.id === poi.id)) return toast('Already on the route', 'warn');
    const wp = { id: poi.id, name: poi.name, x: poi.mapPos.x, y: poi.mapPos.y, elevation: getElevationAtPoint(missionId, poi.mapPos.x, poi.mapPos.y), type: 'science', sampleId: poi.tubeId };
    setWps((w) => (w.length > 1 && w[w.length - 1].type === 'hab' ? [...w.slice(0, -1), wp, w[w.length - 1]] : [...w, wp]));
    toast(`Added ${poi.name} to the traverse`, 'ok');
  };
  const removeWaypoint = (id) => setWps((w) => w.filter((x) => x.id !== id));
  const addHabReturn = () => {
    const h = mission.habSite;
    if (waypoints[waypoints.length - 1]?.type === 'hab') return toast('Route already ends at the habitat', 'warn');
    setWps((w) => [...w, { id: `hab-${Date.now()}`, name: `${h.name} (return)`, x: h.x, y: h.y, elevation: getElevationAtPoint(missionId, h.x, h.y), type: 'hab' }]);
  };
  const resetRoute = () => {
    timers.current.forEach(clearTimeout);
    setWpMap((m) => ({ ...m, [missionId]: seed()[missionId] }));
    setHzMap((m) => ({ ...m, [missionId]: [] }));
    setLog([]);
    toast('Plan reset to the mission baseline', 'info');
  };
  const clearHazards = () => { timers.current.forEach(clearTimeout); setHzMap((m) => ({ ...m, [missionId]: [] })); setLog([]); };

  // Mirrors the system design's hazard path: report -> validate -> publish -> invalidate caches -> replacement route.
  const reportHazard = useCallback((kind, fromT = 0) => {
    const L = latest.current, pts = L.path.points;
    if (pts.length < 10) return toast('Add at least two checkpoints first', 'warn');
    const stationPts = L.path.stations.map((s) => pts[s.index]);
    let at = pts[Math.floor(pts.length / 2)], far = -1;
    for (const p of pts) {
      if (p.t < Math.max(0.12, fromT + 0.06) || p.t > 0.88) continue;
      const d = Math.min(...stationPts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      if (d > far) { far = d; at = p; }
    }
    const k = HAZARD_KINDS[kind], id = `hz${Date.now().toString(36)}`;
    const v = Object.values(hzMap).flat().length + 1, t0 = Date.now();
    const step = (n, title, detail, tone = 'ok') => setLog((l) => [...l, { id: `${id}-${n}`, n, title, detail, tone, at: Date.now() - t0 }]);
    setHzMap((m) => ({ ...m, [L.missionId]: [...(m[L.missionId] || []), { id, kind, x: at.x, y: at.y, r: k.r, v, validated: false }] }));
    step(1, 'Hazard report received', `${k.label} near ${at.x}, ${at.y}. Signed by EVA crew.`, 'info');
    const later = (ms, fn) => timers.current.push(setTimeout(fn, ms));
    later(650, () => step(2, 'Validated by Mission Control', 'Confidence 0.92, matches orbital roughness data.'));
    later(1150, () => {
      setHzMap((m) => ({ ...m, [L.missionId]: (m[L.missionId] || []).map((h) => (h.id === id ? { ...h, validated: true } : h)) }));
      step(3, `Hazard v${v} published`, 'Durable event queued; cached routes marked pending revalidation.');
    });
    later(1700, () => {
      const re = calculateRouteMetrics(generateDensePath(L.waypoints, L.missionId, L.routeMode, [...L.routing, { x: at.x, y: at.y, r: k.r }]).points);
      const dKm = ((re.distanceKm - L.metrics.distanceKm) * 1000) | 0, dMin = re.estimatedTimeMin - L.metrics.estimatedTimeMin;
      step(4, 'A* replacement published', `${dKm >= 0 ? '+' : ''}${dKm} m, ${dMin >= 0 ? '+' : ''}${dMin} min. Terrain costs include the new hazard.`);
      toast(`Terrain-aware reroute ready (${dKm >= 0 ? '+' : ''}${dKm} m)`, 'ok');
    });
  }, [hzMap]);

  const value = {
    mission, missionId, setMissionId, routeMode, setRouteMode, waypoints, stations, path, points: path.points, metrics, endPlss, assessment,
    pois, selectedPoiId, setSelectedPoiId, addPoiToRoute, removeWaypoint, addHabReturn, resetRoute,
    savePlan, hazards, routing, hazardLog: log, reportHazard, clearHazards, revalidating: hazards.some((h) => !h.validated),
    planVersion: 1 + routing.length
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useMission = () => useContext(Ctx);
export { MISSIONS };
