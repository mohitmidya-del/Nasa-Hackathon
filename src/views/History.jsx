import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useMission } from '../context/MissionContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { Icon } from '../lib/icons.jsx';
import { PageHead } from '../lib/ui.jsx';

export default function History() {
  const { user, isAuthenticated, setAuthModalOpen, traverses, loadingTraverses, refreshHistory } = useAuth();
  const { setDestination, relocateTo } = useNavigation();
  const { setMissionId } = useMission();
  const { setView } = useUi();
  const [selectedTraverse, setSelectedTraverse] = useState(null);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-4">
        <PageHead
          title="Route & Hazard History"
          sub="Indexed PostgreSQL database record of astronaut traverses, safe paths, and localized Martian hazards."
        />
        <div className="card p-8 flex flex-col items-center justify-center text-center max-w-lg mx-auto gap-4 mt-6">
          <div className="w-14 h-14 rounded-full bg-ember/15 text-ember flex items-center justify-center">
            <Icon n="user" s={28} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Sign In to View Route History</h2>
            <p className="text-xs text-dust mt-1 max-w-sm">
              Your traverse records, waypoints, telemetry metrics, and nearby detected hazards are securely saved in the PostgreSQL database.
            </p>
          </div>
          <button
            className="btn btn-pri !min-h-10 !px-6"
            onClick={() => setAuthModalOpen(true)}
          >
            <Icon n="lock" s={14} /> Sign In / Register
          </button>
        </div>
      </div>
    );
  }

  const activeTraverse = selectedTraverse || traverses[0] || null;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="EVA Route History & Hazard Paths"
        sub={`Logged in as ${user?.callsign || user?.username} (${user?.role}) · PostgreSQL database storage active.`}
      >
        <button
          className="btn btn-ghost"
          onClick={refreshHistory}
          disabled={loadingTraverses}
        >
          <Icon n="reset" s={14} /> Refresh Records
        </button>
      </PageHead>

      {traverses.length === 0 ? (
        <div className="card p-8 text-center flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-panel2 flex items-center justify-center text-dust">
            <Icon n="route" s={22} />
          </div>
          <h3 className="font-semibold text-sm">No Traverse History Recorded Yet</h3>
          <p className="text-xs text-dust max-w-md">
            When you select a destination or walk an EVA path in the Surface Explorer, save your route to store it and its corridor hazard details directly in PostgreSQL.
          </p>
          <button
            className="btn btn-pri mt-2"
            onClick={() => setView('explorer')}
          >
            Open Surface Explorer
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* List of traverses */}
          <div className="flex flex-col gap-2.5 max-h-[720px] scroll-y" role="listbox">
            {traverses.map((t) => {
              const isSelected = activeTraverse?.id === t.id;
              const dateStr = t.created_at ? new Date(t.created_at).toLocaleString() : 'Recent';
              const decTag =
                t.decision === 'GO'
                  ? 'tag-go'
                  : t.decision === 'CAUTION'
                  ? 'tag-caution'
                  : 'tag-hold';
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTraverse(t)}
                  role="option"
                  aria-selected={isSelected}
                  className={`card p-4 text-left transition-all flex flex-col gap-2 ${
                    isSelected ? '!border-dusk/60 bg-panel2 shadow-md' : 'hover:bg-panel2'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-[13px] truncate">
                      {t.route_name || 'EVA Route'}
                    </span>
                    <span className={`tag ${decTag}`}>{t.decision}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-dust">
                    <span className="capitalize">{t.mission_id} · {t.route_mode}</span>
                    <span className="num font-semibold text-bone">{t.distance_km} km</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-dim border-t border-line pt-2">
                    <span>{dateStr}</span>
                    <span className="text-amber-400 font-medium">
                      {t.nearby_hazards?.length || 0} hazard{(t.nearby_hazards?.length || 0) === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detailed view of active traverse */}
          {activeTraverse && (
            <div className="flex flex-col gap-4">
              <section className="card p-5 sm:p-6 flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-dusk font-semibold">
                      Mission: {activeTraverse.mission_id.toUpperCase()} · Mode: {activeTraverse.route_mode}
                    </div>
                    <h2 className="display text-2xl font-semibold mt-1">
                      {activeTraverse.route_name}
                    </h2>
                    <p className="text-xs text-dust mt-1">
                      Recorded on {new Date(activeTraverse.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-pri"
                      onClick={() => {
                        setMissionId(activeTraverse.mission_id);
                        if (activeTraverse.end) {
                          setDestination({
                            id: `hist-${activeTraverse.id}`,
                            name: activeTraverse.route_name,
                            lat: activeTraverse.end.lat,
                            lon: activeTraverse.end.lon,
                          });
                        }
                        setView('explorer');
                      }}
                    >
                      <Icon n="target" s={14} /> Load in Explorer
                    </button>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="well p-3">
                    <div className="text-xs text-dust">Distance</div>
                    <div className="num font-semibold text-base">{activeTraverse.distance_km} km</div>
                  </div>
                  <div className="well p-3">
                    <div className="text-xs text-dust">Duration</div>
                    <div className="num font-semibold text-base">{activeTraverse.estimated_time_min} min</div>
                  </div>
                  <div className="well p-3">
                    <div className="text-xs text-dust">Max Slope</div>
                    <div className="num font-semibold text-base">{activeTraverse.max_slope_deg}°</div>
                  </div>
                  <div className="well p-3">
                    <div className="text-xs text-dust">Safety Score</div>
                    <div className="num font-semibold text-base text-sol">
                      {activeTraverse.safety_score}/100
                    </div>
                  </div>
                </div>

                {/* Coordinates */}
                <div className="well p-3.5 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-dust">Corridor Coordinates</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-dim">Start: </span>
                      <span className="num font-medium text-bone">
                        {activeTraverse.start?.lat?.toFixed(5)}°, {activeTraverse.start?.lon?.toFixed(5)}°
                      </span>
                    </div>
                    <div>
                      <span className="text-dim">Destination: </span>
                      <span className="num font-medium text-bone">
                        {activeTraverse.end?.lat?.toFixed(5)}°, {activeTraverse.end?.lon?.toFixed(5)}°
                      </span>
                    </div>
                  </div>
                </div>

                {/* Hazards stored along this path */}
                <div className="flex flex-col gap-2.5 pt-2 border-t border-line">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold row">
                      <Icon n="alert" s={15} className="text-hazard" />
                      Hazards along Selected Path ({activeTraverse.nearby_hazards?.length || 0})
                    </h3>
                  </div>

                  {(!activeTraverse.nearby_hazards || activeTraverse.nearby_hazards.length === 0) ? (
                    <p className="text-xs text-dust well p-3">
                      No critical hazards detected directly in this path corridor.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {activeTraverse.nearby_hazards.map((h) => (
                        <div key={h.id} className="well p-3 flex flex-col gap-1.5 border-l-2 border-l-amber-500">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-bone">{h.hazard_name}</span>
                            <span className="tag tag-caution !h-5 !text-[10px]">
                              Severity {h.severity}/5
                            </span>
                          </div>
                          <div className="text-[11px] text-dust">
                            Category: <span className="text-bone capitalize">{h.category}</span>
                            {h.distance_from_path_km ? ` · ${h.distance_from_path_km.toFixed(2)} km from path` : ''}
                          </div>
                          <div className="text-[10px] num text-dim">
                            Lat: {h.lat?.toFixed(4)}° | Lon: {h.lon?.toFixed(4)}°
                          </div>
                          {h.detail && <p className="text-[11px] text-dust mt-0.5">{h.detail}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
