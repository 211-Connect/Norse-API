// k6 load test for GET /v2/search (Norse-API). See load-tests/v2-search/README.md before running.
// Open model: arrival-rate executors, because search traffic does not wait for answers.
// One iteration = one search request. Patterns reused from the ServiceNet provider-feedback
// harness: brake, canary, stop-at-slow per level, warm-up, host guard, handleSummary.
import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Trend, Rate, Counter } from "k6/metrics";

// ---------------------------------------------------------------- env
const env = (name, dflt) =>
  __ENV[name] !== undefined && __ENV[name] !== "" ? __ENV[name] : dflt;
const num = (name, d) => Number(env(name, String(d)));

const RAW_BASE = env("BASE_URL", "");
if (!RAW_BASE) throw new Error("BASE_URL is required, for example http://localhost:8093");
const BASE_URL = RAW_BASE.replace(/\/+$/, "");
if (BASE_URL.indexOf("@") !== -1) throw new Error('BASE_URL must not contain "@"');
const hostMatch = /^https?:\/\/(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i.exec(BASE_URL);
if (!hostMatch) throw new Error("BASE_URL must be http(s)://host[:port][/path]");
// Strip trailing dots: "api.c211.io." is a valid FQDN that resolves to prod.
const HOST = hostMatch[1].toLowerCase().replace(/\.+$/, "");

const TENANT_ID = env("TENANT_ID", "");
if (!TENANT_ID) throw new Error("TENANT_ID is required (sent as the x-tenant-id header)");
const ACCEPT_LANGUAGE = env("ACCEPT_LANGUAGE", "en");

const PROFILE = env("PROFILE", "smoke");
if (!["smoke", "ramp", "spike", "soak"].includes(PROFILE)) {
  throw new Error(`PROFILE must be smoke, ramp, spike or soak (got ${PROFILE})`);
}
const LOADED = PROFILE !== "smoke";

// ---------------------------------------------------------------- host guard
const isLocal = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(HOST) || HOST.endsWith(".localhost");
// Dev hosts known to the team: api-dev.c211.io (App Platform, direct), dev-services.c211.io (gateway).
// Every other *.c211.io host counts as production, so an unknown host is refused, not trusted.
const isDevHost = /^(api-dev|dev-services|demo|staging)\.c211\.io$/.test(HOST) || /^dev[a-z0-9-]*\.c211\.io$/.test(HOST);
const isC211 = HOST === "c211.io" || HOST.endsWith(".c211.io");
if (isC211 && !isDevHost && env("ALLOW_PROD", "") !== "yes") {
  throw new Error(
    `Refusing to run against ${HOST}: it is not a known dev host, so it counts as production. ` +
      "Set ALLOW_PROD=yes only when Lucas has said so for this run.",
  );
}
if (isLocal && LOADED && env("ALLOW_LOCAL_LOAD", "") !== "yes") {
  throw new Error(
    `Refusing PROFILE=${PROFILE} against ${HOST}: a local Norse-API server reads production Elasticsearch. ` +
      "Only PROFILE=smoke is allowed there. Set ALLOW_LOCAL_LOAD=yes to override.",
  );
}
if (isC211 && isDevHost) {
  console.warn(
    `NOTE: target ${HOST} is a dev host. Dev and prod share ONE ml-broker instance (2 vCPU / 4 GB), ` +
      "so this test also loads production classification. Tell the ml-broker and Elasticsearch owners first.",
  );
}

// ---------------------------------------------------------------- options (all overridable)
const MAX_RPS = num("MAX_RPS", 20); // hard cap on any arrival rate, any profile
const RAMP_STEPS = env("RAMP_STEPS", "1,2,5,10,15,20").split(",").map((s) => Number(s.trim()));
const STEP_S = num("STEP_S", 120); // hold time per ramp step
const RAMP_UP_S = num("RAMP_UP_S", 10); // time to climb to the next step
const SPIKE_BASE_RPS = num("SPIKE_BASE_RPS", 1);
const SPIKE_S = num("SPIKE_S", 60);
const SPIKE_PRE_S = num("SPIKE_PRE_S", 30);
const SPIKE_POST_S = num("SPIKE_POST_S", 60);
const SOAK_RPS = Math.min(num("SOAK_RPS", 10), MAX_RPS);
const SOAK_MIN = num("SOAK_MIN", 10);
const SMOKE_ITERATIONS = num("SMOKE_ITERATIONS", 5);

const MAX_VUS = num("MAX_VUS", 300);
const REQ_TIMEOUT_MS = num("REQ_TIMEOUT_MS", 10000);
const SLOW_LOG_MS = num("SLOW_LOG_MS", 2000);

// traffic mix: shares of the request VARIANT (one roll per request, shares must sum to at most 1;
// the rest is a plain page-1 text query) and the share of popular (repeated) queries.
const POPULAR_SHARE = num("POPULAR_SHARE", 0.5);
const POPULAR_TOP = num("POPULAR_TOP", 10); // the N highest-weight queries form the popular pool
const GEO_SHARE = num("GEO_SHARE", 0.15);
const PAGE2_SHARE = num("PAGE2_SHARE", 0.1);
const CLARIFY_NEVER_SHARE = num("CLARIFY_NEVER_SHARE", 0.1);
const CUTOFF_SHARE = num("CUTOFF_SHARE", 0); // relevance_cutoff=on: about 2.2 s server time, keep at 0
const GEO_DISTANCE = num("GEO_DISTANCE", 10);
const ONEOFF_NONCE = env("ONEOFF_NONCE", "cycle"); // cycle | always | never
const GEO_POINTS = env(
  "GEO_POINTS",
  "-87.6298,41.8781;-73.9857,40.7484;-76.1474,43.0481;-88.0817,41.8239",
).split(";");

// brakes
const P95_LIMIT_MS = num("P95_LIMIT_MS", 3000);
const ERROR_RATE_LIMIT = num("ERROR_RATE_LIMIT", 0.05);
const CLASSIFY_FAILED_LIMIT = num("CLASSIFY_FAILED_LIMIT", 0.2);
const JUDGE_AFTER_S = num("JUDGE_AFTER_S", 30); // judge a level only this long after it starts
const BRAKE = env("BRAKE", LOADED ? "1" : "0") === "1";
const BRAKE_MS = num("BRAKE_MS", 8000);
const BRAKE_STREAK = num("BRAKE_STREAK", 3);
const STOP_AT_SLOW = env("STOP_AT_SLOW", "1") === "1";
const CANARY = env("CANARY", LOADED ? "1" : "0") === "1";
const CANARY_URL = env("CANARY_URL", "https://ml-broker.c211.io/health/live");
const CANARY_EVERY_S = num("CANARY_EVERY_S", 15);
const CANARY_BRAKE_MS = num("CANARY_BRAKE_MS", 3000);
const CANARY_STREAK = num("CANARY_STREAK", 3);
const CANARY_LEAD_S = CANARY ? num("CANARY_LEAD_S", 60) : 0;
const WARMUP = env("WARMUP", LOADED ? "1" : "0") === "1";
const WARMUP_REQUESTS = num("WARMUP_REQUESTS", 5);

const API_KEY = env("API_KEY", ""); // optional, never logged
const API_KEY_HEADER = env("API_KEY_HEADER", "x-api-key");
const RESULTS_DIR = env("RESULTS_DIR", "load-tests/v2-search/results");
const QUERIES_FILE = env("QUERIES_FILE", "queries.sample.json");

for (const [k, v] of Object.entries({
  MAX_RPS, STEP_S, RAMP_UP_S, SPIKE_BASE_RPS, SPIKE_S, SOAK_RPS, SOAK_MIN, MAX_VUS, POPULAR_SHARE, GEO_SHARE,
  PAGE2_SHARE, CLARIFY_NEVER_SHARE, CUTOFF_SHARE, P95_LIMIT_MS, ERROR_RATE_LIMIT, CLASSIFY_FAILED_LIMIT,
  BRAKE_STREAK, CANARY_EVERY_S, CANARY_STREAK, REQ_TIMEOUT_MS, POPULAR_TOP, SMOKE_ITERATIONS,
})) {
  // A typo gives NaN, and NaN fails silently (comparisons are always false). Fail loudly.
  if (!Number.isFinite(v) || v < 0) throw new Error(`${k} must be a non-negative number (got ${__ENV[k]})`);
}
for (const [k, v] of Object.entries({ MAX_RPS, STEP_S, SPIKE_S, SOAK_RPS, SOAK_MIN, BRAKE_STREAK, CANARY_EVERY_S, CANARY_STREAK, SMOKE_ITERATIONS })) {
  if (v <= 0) throw new Error(`${k} must be above 0 (got ${__ENV[k]})`);
}
if (RAMP_STEPS.length === 0 || RAMP_STEPS.some((n) => !Number.isFinite(n) || n <= 0)) {
  throw new Error(`RAMP_STEPS must be a comma list of positive numbers (got ${__ENV.RAMP_STEPS})`);
}
if (GEO_SHARE + PAGE2_SHARE + CLARIFY_NEVER_SHARE + CUTOFF_SHARE > 1) {
  throw new Error("GEO_SHARE + PAGE2_SHARE + CLARIFY_NEVER_SHARE + CUTOFF_SHARE must not exceed 1");
}
if (!["cycle", "always", "never"].includes(ONEOFF_NONCE)) throw new Error("ONEOFF_NONCE must be cycle, always or never");
for (const p of GEO_POINTS) {
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p)) throw new Error(`GEO_POINTS entry "${p}" must look like -87.6298,41.8781`);
}

// ramp steps above MAX_RPS are dropped, so MAX_RPS is a real cap
const rampSteps = RAMP_STEPS.filter((n) => n <= MAX_RPS);
if (PROFILE === "ramp" && rampSteps.length === 0) throw new Error("every RAMP_STEPS value is above MAX_RPS");

// ---------------------------------------------------------------- queries
const queries = new SharedArray("queries", function () {
  // k6 resolves relative open() paths against this script's folder. Also try the path
  // as written from the repo root (two folders above this script).
  let raw;
  try {
    raw = open(QUERIES_FILE);
  } catch (e) {
    raw = open(`../../${QUERIES_FILE}`);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("QUERIES_FILE must be a non-empty JSON array");
  const rows = parsed.map((r, i) => {
    const q = typeof r === "string" ? r : r && r.query;
    const w = typeof r === "string" ? 1 : r && r.weight !== undefined ? Number(r.weight) : 1;
    if (typeof q !== "string" || !q.trim()) throw new Error(`QUERIES_FILE row ${i} needs a query string`);
    if (!Number.isFinite(w) || w <= 0) throw new Error(`QUERIES_FILE row ${i} has a bad weight`);
    return { query: q, weight: w, i };
  });
  // highest weight first, file order breaks ties
  rows.sort((a, b) => b.weight - a.weight || a.i - b.i);
  return rows;
});
const popularPool = queries.length <= POPULAR_TOP ? Array.from(queries) : Array.from(queries).slice(0, Math.max(1, POPULAR_TOP));
const oneoffPool = queries.length <= POPULAR_TOP ? Array.from(queries) : Array.from(queries).slice(POPULAR_TOP);
const popularTotal = popularPool.reduce((s, r) => s + r.weight, 0);

function pickPopular() {
  let t = Math.random() * popularTotal;
  for (const r of popularPool) {
    t -= r.weight;
    if (t <= 0) return r.query;
  }
  return popularPool[popularPool.length - 1].query;
}
// One-off: walk the pool in order using the scenario-wide iteration count, so no text repeats
// within one pass. After a full pass (or always, with ONEOFF_NONCE=always) a number is appended,
// so the text is new for any embedding cache.
function pickOneoff() {
  const n = exec.scenario.iterationInTest;
  let q = oneoffPool[n % oneoffPool.length].query;
  const cycled = n >= oneoffPool.length;
  if (ONEOFF_NONCE === "always" || (ONEOFF_NONCE === "cycle" && cycled)) {
    q = `${q} ${Math.floor(Math.random() * 1e9)}`;
  }
  return q;
}

// ---------------------------------------------------------------- metrics
// Tags: qgroup = popular | oneoff, variant = plain | geo | page2 | clarify_never | cutoff,
// level = the ramp step, or the profile phase. The summary reports each group by tag.
const reqMs = new Trend("req_ms", true);
const reqError = new Rate("req_error"); // anything but a 200 with a JSON body
const classifyFailed = new Rate("classify_failed"); // 200 answers with model_version null
const clarificationPresent = new Rate("clarification_present");
const requestsSent = new Counter("requests_sent");
const canaryMs = new Trend("canary_ms", true);

// ---------------------------------------------------------------- scenarios
const toSeconds = (d) => {
  const m = /^([\d.]+)(s|m)$/.exec(String(d));
  if (!m) throw new Error(`cannot read duration ${d}`);
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
};
// phases: { level, from, to } in seconds from the main scenario start, for tagging and judging
const phases = [];
let mainScenario;
{
  const vusFor = (rate) => Math.min(MAX_VUS, Math.max(5, Math.ceil(rate * 3)));
  if (PROFILE === "smoke") {
    mainScenario = { executor: "per-vu-iterations", vus: 1, iterations: SMOKE_ITERATIONS, maxDuration: "5m" };
    phases.push({ level: "smoke", from: 0, to: 1e9 });
  } else if (PROFILE === "ramp") {
    const stages = [];
    let t = 0;
    for (const r of rampSteps) {
      stages.push({ duration: `${RAMP_UP_S}s`, target: r });
      stages.push({ duration: `${STEP_S}s`, target: r });
      phases.push({ level: String(r), from: t, to: t + RAMP_UP_S + STEP_S });
      t += RAMP_UP_S + STEP_S;
    }
    stages.push({ duration: "5s", target: 0 });
    phases.push({ level: "end", from: t, to: 1e9 });
    mainScenario = {
      executor: "ramping-arrival-rate",
      startRate: Math.min(rampSteps[0], 1),
      timeUnit: "1s",
      preAllocatedVUs: vusFor(rampSteps[rampSteps.length - 1]),
      maxVUs: MAX_VUS,
      stages,
      gracefulStop: "30s",
    };
  } else if (PROFILE === "spike") {
    const base = Math.min(SPIKE_BASE_RPS, MAX_RPS);
    mainScenario = {
      executor: "ramping-arrival-rate",
      startRate: base,
      timeUnit: "1s",
      preAllocatedVUs: vusFor(MAX_RPS),
      maxVUs: MAX_VUS,
      stages: [
        { duration: `${SPIKE_PRE_S}s`, target: base },
        { duration: "1s", target: MAX_RPS }, // the jump
        { duration: `${SPIKE_S}s`, target: MAX_RPS },
        { duration: "1s", target: base },
        { duration: `${SPIKE_POST_S}s`, target: base },
      ],
      gracefulStop: "30s",
    };
    phases.push({ level: "pre", from: 0, to: SPIKE_PRE_S });
    phases.push({ level: "spike", from: SPIKE_PRE_S, to: SPIKE_PRE_S + 1 + SPIKE_S });
    phases.push({ level: "recovery", from: SPIKE_PRE_S + 1 + SPIKE_S, to: 1e9 });
  } else {
    mainScenario = {
      executor: "constant-arrival-rate",
      rate: SOAK_RPS,
      timeUnit: "1s",
      duration: `${SOAK_MIN}m`,
      preAllocatedVUs: vusFor(SOAK_RPS),
      maxVUs: MAX_VUS,
      gracefulStop: "30s",
    };
    phases.push({ level: "soak", from: 0, to: 1e9 });
  }
}
const levels = phases.map((p) => p.level).filter((l) => l !== "end");
function currentLevel() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  for (const p of phases) if (elapsed < p.to) return p.level;
  return phases[phases.length - 1].level;
}
const mainStartS = CANARY_LEAD_S;
const mainSeconds = (() => {
  if (PROFILE === "smoke") return 60;
  if (PROFILE === "soak") return SOAK_MIN * 60;
  return phases[phases.length - 1].from + (phases[phases.length - 1].to < 1e9 ? 0 : 0) + (PROFILE === "spike" ? SPIKE_POST_S : 5);
})();

const scenarios = {};
scenarios[PROFILE] = Object.assign({}, mainScenario, mainStartS ? { startTime: `${mainStartS}s` } : {});
if (CANARY) {
  scenarios.canary = {
    executor: "constant-arrival-rate",
    exec: "canary",
    rate: 1,
    timeUnit: `${CANARY_EVERY_S}s`,
    duration: `${Math.ceil(CANARY_LEAD_S + mainSeconds + 60)}s`,
    preAllocatedVUs: 1,
    maxVUs: 1, // one VU, so the streak counter lives in one place
  };
}

// ---------------------------------------------------------------- thresholds
const REPORT_ONLY = { trend: "max>=0", rate: "rate>=0" };
const thresholds = {
  req_error: [`rate<${ERROR_RATE_LIMIT}`],
  req_ms: [`p(95)<${P95_LIMIT_MS}`],
  classify_failed: [`rate<${CLASSIFY_FAILED_LIMIT}`],
};
if (BRAKE) {
  // backstop over the whole run, checked after the load has run for a while
  const d = `${CANARY_LEAD_S + 60}s`;
  thresholds.req_error.push({ threshold: `rate<${ERROR_RATE_LIMIT}`, abortOnFail: true, delayAbortEval: d });
  thresholds.classify_failed.push({ threshold: `rate<${CLASSIFY_FAILED_LIMIT}`, abortOnFail: true, delayAbortEval: d });
}
// Per level (ramp step or spike phase): k6 evaluates a tagged sub-metric over the samples of that
// level only, which gives the "sustained window". It is judged JUDGE_AFTER_S after the level starts.
for (const p of phases) {
  if (p.level === "end") continue;
  const delay = `${Math.ceil(CANARY_LEAD_S + p.from + JUDGE_AFTER_S)}s`;
  const judged = BRAKE && STOP_AT_SLOW && PROFILE !== "smoke";
  const t = (expr) => (judged ? [{ threshold: expr, abortOnFail: true, delayAbortEval: delay }] : [expr]);
  thresholds[`req_ms{level:${p.level}}`] = t(`p(95)<${P95_LIMIT_MS}`);
  thresholds[`req_error{level:${p.level}}`] = t(`rate<${ERROR_RATE_LIMIT}`);
  thresholds[`classify_failed{level:${p.level}}`] = t(`rate<${CLASSIFY_FAILED_LIMIT}`);
}
// report-only sub-metrics: they make k6 keep the per-group numbers for the summary
const GROUP_TAGS = ["qgroup:popular", "qgroup:oneoff", "variant:plain", "variant:geo", "variant:page2", "variant:clarify_never", "variant:cutoff"];
for (const g of GROUP_TAGS) {
  thresholds[`req_ms{${g}}`] = [REPORT_ONLY.trend];
  thresholds[`req_error{${g}}`] = [REPORT_ONLY.rate];
  thresholds[`classify_failed{${g}}`] = [REPORT_ONLY.rate];
  thresholds[`clarification_present{${g}}`] = [REPORT_ONLY.rate];
}

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ["count", "avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  setupTimeout: "5m",
};

// ---------------------------------------------------------------- helpers
const hex = (n) => {
  let s = "";
  for (let i = 0; i < n; i++) s += ((Math.random() * 16) | 0).toString(16);
  return s;
};
function baseHeaders() {
  const h = { "x-tenant-id": TENANT_ID, "accept-language": ACCEPT_LANGUAGE, accept: "application/json" };
  if (API_KEY) h[API_KEY_HEADER] = API_KEY;
  return h;
}
function pickVariant() {
  const r = Math.random();
  let acc = 0;
  for (const [name, share] of [
    ["geo", GEO_SHARE],
    ["page2", PAGE2_SHARE],
    ["clarify_never", CLARIFY_NEVER_SHARE],
    ["cutoff", CUTOFF_SHARE],
  ]) {
    acc += share;
    if (r < acc) return name;
  }
  return "plain";
}
function buildUrl(query, variant) {
  const q = [`query=${encodeURIComponent(query)}`];
  if (variant === "geo") {
    q.push(`coords=${GEO_POINTS[Math.floor(Math.random() * GEO_POINTS.length)]}`);
    q.push(`distance=${GEO_DISTANCE}`);
  } else if (variant === "page2") {
    q.push("page=2");
  } else if (variant === "clarify_never") {
    q.push("clarify=never");
  } else if (variant === "cutoff") {
    q.push("relevance_cutoff=on");
  }
  return `${BASE_URL}/v2/search?${q.join("&")}`;
}
function parseJson(res) {
  try {
    return res.json();
  } catch (e) {
    return null;
  }
}

let brakeStreak = 0; // per VU: each VU has its own copy of module state
function brake(res, level) {
  if (!BRAKE) return;
  const bad = res.status === 0 || res.status >= 500 || res.timings.duration > BRAKE_MS;
  brakeStreak = bad ? brakeStreak + 1 : 0;
  if (brakeStreak >= BRAKE_STREAK) {
    const why =
      `BRAKE: VU ${__VU} saw ${brakeStreak} slow or failed requests in a row ` +
      `(last: status ${res.status} in ${res.timings.duration.toFixed(0)} ms; limit ${BRAKE_MS} ms). ` +
      `Level ${level}, VUs active ${exec.instance.vusActive}.`;
    console.error(why);
    exec.test.abort(why);
  }
}

// One search request. Returns the response. `record` false = warm-up (no metrics).
let logged = 0; // per VU: cap on log lines
function oneSearch(query, qgroup, variant, record, level) {
  const traceId = hex(32);
  const headers = Object.assign(baseHeaders(), { traceparent: `00-${traceId}-${hex(16)}-01` });
  const res = http.get(buildUrl(query, variant), {
    headers,
    timeout: `${REQ_TIMEOUT_MS}ms`,
    tags: { name: "GET /v2/search", qgroup, variant },
    // 4xx and 5xx are counted by our own metrics, not as k6 failures
    responseCallback: http.expectedStatuses({ min: 0, max: 599 }),
  });
  const body = res.status === 200 ? parseJson(res) : null;
  const hasHits = !!(body && body.search && body.search.hits !== undefined);
  const ok = res.status === 200 && hasHits;
  const modelVersionNull = res.status === 200 && body && (body.model_version === null || body.model_version === undefined);
  if (record) {
    const tags = { qgroup, variant, level };
    requestsSent.add(1, tags);
    if (res.status !== 0) reqMs.add(res.timings.duration, tags);
    reqError.add(!ok, tags);
    if (res.status === 200 && body) {
      classifyFailed.add(!!modelVersionNull, tags);
      clarificationPresent.add(body.clarification !== null && body.clarification !== undefined, tags);
    }
    check(res, {
      "status 200": (r) => r.status === 200,
      "json has search.hits": () => hasHits,
      "model_version not null": () => !modelVersionNull,
    });
    brake(res, level);
  }
  const slow = res.timings.duration > SLOW_LOG_MS;
  if ((!ok || slow) && logged < 25) {
    logged++;
    // trace id only: never the query text
    console.warn(
      `${ok ? "SLOW" : "FAIL"} trace_id=${traceId} status=${res.status} ms=${Math.round(res.timings.duration)} ` +
        `qgroup=${qgroup} variant=${variant} level=${level}`,
    );
  }
  return res;
}

// ---------------------------------------------------------------- lifecycle
// The first requests after a deploy pay cold costs (connections, JIT, caches). The warm-up pays
// them before the load; its requests are not in any metric the brakes or the summary read.
export function setup() {
  if (!WARMUP) return;
  let okCount = 0;
  for (let i = 0; i < WARMUP_REQUESTS; i++) {
    const row = queries[i % queries.length];
    const res = oneSearch(row.query, "popular", "plain", false, "warmup");
    const body = res.status === 200 ? parseJson(res) : null;
    if (res.status === 200 && body && body.search) okCount++;
    console.log(`WARMUP ${i + 1}/${WARMUP_REQUESTS}: status ${res.status} in ${Math.round(res.timings.duration)} ms`);
  }
  if (okCount === 0) {
    throw new Error("WARMUP failed: no warm-up request returned a 200 with search.hits. Check BASE_URL, TENANT_ID, auth and V2_SEARCH_ENABLED before a loaded run.");
  }
}

const canaryStreak = { n: 0 };
export function canary() {
  const res = http.get(CANARY_URL, { tags: { canary: "ml_broker" }, timeout: "10s", responseCallback: http.expectedStatuses({ min: 0, max: 599 }) });
  if (res.status !== 0) canaryMs.add(res.timings.duration);
  const bad = res.status !== 200 || res.timings.duration > CANARY_BRAKE_MS;
  canaryStreak.n = bad ? canaryStreak.n + 1 : 0;
  if (canaryStreak.n >= CANARY_STREAK) {
    const why =
      `CANARY BRAKE: ml-broker health was slow or wrong ${canaryStreak.n} times in a row ` +
      `(last: status ${res.status}, ${res.timings.duration.toFixed(0)} ms; limit ${CANARY_BRAKE_MS} ms). ` +
      "Production classification may be affected: the test stops now.";
    console.error(why);
    exec.test.abort(why);
  }
}

export default function () {
  const level = currentLevel();
  const qgroup = Math.random() < POPULAR_SHARE ? "popular" : "oneoff";
  const variant = pickVariant();
  const query = qgroup === "popular" ? pickPopular() : pickOneoff();
  oneSearch(query, qgroup, variant, true, level);
}

// ---------------------------------------------------------------- summary
const vals = (m) => (m ? m.values || m : undefined);
const f0 = (v) => (v === undefined || v === null || Number.isNaN(v) ? "-" : Number(v).toFixed(0));
const pct = (v) => (v === undefined || v === null || Number.isNaN(v) ? "-" : `${(v * 100).toFixed(1)}%`);

function groupRow(m, label, tag) {
  const t = vals(m[`req_ms{${tag}}`]);
  const e = vals(m[`req_error{${tag}}`]);
  const c = vals(m[`classify_failed{${tag}}`]);
  const n = t && t.count ? t.count : 0;
  if (!n) return `${label.padEnd(16)} ${"0".padStart(6)}`;
  return (
    `${label.padEnd(16)} ${String(n).padStart(6)} ${f0(t.med).padStart(6)} ${f0(t["p(95)"]).padStart(6)} ` +
    `${f0(t["p(99)"]).padStart(6)} ${pct(e && e.rate).padStart(8)} ${pct(c && c.rate).padStart(9)}`
  );
}

function textSummary(data) {
  const m = data.metrics;
  const lines = [`\nv2-search load test: profile=${PROFILE} host=${HOST} max_rps=${MAX_RPS}`];
  const all = vals(m.req_ms);
  const sent = vals(m.requests_sent);
  const dropped = vals(m.dropped_iterations);
  lines.push(`requests=${sent ? sent.count : 0} dropped_iterations=${dropped ? dropped.count : 0} (dropped = the generator could not keep the rate; raise MAX_VUS)`);
  if (all) lines.push(`all: p50=${f0(all.med)} p95=${f0(all["p(95)"])} p99=${f0(all["p(99)"])} max=${f0(all.max)} ms`);
  const err = vals(m.req_error);
  const cf = vals(m.classify_failed);
  const cl = vals(m.clarification_present);
  lines.push(`error rate=${pct(err && err.rate)}  classify_failed=${pct(cf && cf.rate)}  clarification present=${pct(cl && cl.rate)}`);
  lines.push("");
  lines.push("group            count    p50    p95    p99  error%  classify_failed%  (ms)");
  for (const [label, tag] of [
    ["popular", "qgroup:popular"],
    ["one-off", "qgroup:oneoff"],
    ["plain", "variant:plain"],
    ["geo", "variant:geo"],
    ["page2", "variant:page2"],
    ["clarify=never", "variant:clarify_never"],
    ["cutoff=on", "variant:cutoff"],
  ]) {
    lines.push(groupRow(m, label, tag));
  }
  if (levels.length > 1) {
    lines.push("");
    lines.push("level (rps/phase) count    p50    p95    p99  error%  classify_failed%  verdict");
    for (const lv of levels) {
      const t = vals(m[`req_ms{level:${lv}}`]);
      const e = vals(m[`req_error{level:${lv}}`]);
      const c = vals(m[`classify_failed{level:${lv}}`]);
      const n = t && t.count ? t.count : 0;
      if (!n) {
        lines.push(`${lv.padEnd(16)}   not reached`);
        continue;
      }
      const th = (name) => (m[name] && m[name].thresholds ? Object.values(m[name].thresholds) : []);
      const slow = [`req_ms{level:${lv}}`, `req_error{level:${lv}}`, `classify_failed{level:${lv}}`].some((nm) => th(nm).some((x) => !x.ok));
      lines.push(
        `${lv.padEnd(16)} ${String(n).padStart(6)} ${f0(t.med).padStart(6)} ${f0(t["p(95)"]).padStart(6)} ${f0(t["p(99)"]).padStart(6)} ` +
          `${pct(e && e.rate).padStart(8)} ${pct(c && c.rate).padStart(9)}  ${slow ? "OVER A LINE" : "ok"}`,
      );
    }
  }
  const cm = vals(m.canary_ms);
  if (cm && cm.count) lines.push(`\ncanary ml-broker health: count=${cm.count} p50=${f0(cm.med)} p95=${f0(cm["p(95)"])} max=${f0(cm.max)} ms`);
  lines.push("");
  for (const name of ["req_error", "req_ms", "classify_failed"]) {
    const th = m[name] && m[name].thresholds;
    if (!th) continue;
    for (const expr of Object.keys(th)) lines.push(`threshold ${th[expr].ok ? "PASS" : "FAIL"}  ${name} ${expr}`);
  }
  lines.push(
    "If the run stopped early, the reason is in the log: a line starting BRAKE or CANARY BRAKE, " +
      "or 'thresholds on metrics ... were crossed' (a level over a line; marked OVER A LINE above).",
  );
  return lines.join("\n") + "\n";
}

export function handleSummary(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const text = textSummary(data);
  const base = `${RESULTS_DIR}/v2-search-${PROFILE}-${stamp}`;
  const out = { stdout: text };
  out[`${base}.txt`] = text;
  out[`${base}.json`] = JSON.stringify(
    {
      profile: PROFILE,
      host: HOST, // the full URL stays out: it may hold a path the team treats as private
      tenant_id_set: true,
      mix: { POPULAR_SHARE, POPULAR_TOP, GEO_SHARE, PAGE2_SHARE, CLARIFY_NEVER_SHARE, CUTOFF_SHARE, ONEOFF_NONCE },
      limits: { MAX_RPS, P95_LIMIT_MS, ERROR_RATE_LIMIT, CLASSIFY_FAILED_LIMIT },
      queries_loaded: queries.length,
      data,
    },
    null,
    2,
  );
  return out;
}
