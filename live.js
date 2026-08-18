import Hls from "hls.js";

const storageKey = "wildwatch_public_job";
const liveTab = document.querySelector("#live-tab");
const preparedTab = document.querySelector("#prepared-tab");
const livePanel = document.querySelector("#live-panel");
const preparedPanel = document.querySelector("#prepared-panel");
const form = document.querySelector("#live-form");
const sourceInput = document.querySelector("#live-source");
const lensInput = document.querySelector("#live-lens");
const submit = document.querySelector("#live-submit");
const errorBox = document.querySelector("#live-error");
const result = document.querySelector("#live-result");
const observations = document.querySelector("#live-observations");
let polling;
let hlsPlayer;
let activePlayback;

function setMode(mode) {
  const live = mode === "live";
  liveTab.setAttribute("aria-selected", String(live));
  preparedTab.setAttribute("aria-selected", String(!live));
  livePanel.hidden = !live;
  preparedPanel.hidden = live;
}

function playerUrl(streamUrl) {
  return `https://console.videodb.io/player?url=${encodeURIComponent(streamUrl)}`;
}

function attachPlayback(streamUrl, jobId) {
  const playbackKey = `${jobId}:${streamUrl}`;
  if (activePlayback === playbackKey) return;
  activePlayback = playbackKey;
  const video = document.querySelector("#live-player");
  const status = document.querySelector("#live-player-status");
  hlsPlayer?.destroy();
  hlsPlayer = undefined;
  video.removeAttribute("src");
  video.load();
  status.textContent = "Loading the VideoDB evidence stream…";
  const browserSafeUrl = `/api/jobs/${encodeURIComponent(jobId)}/media/master.m3u8`;
  if (Hls.isSupported()) {
    hlsPlayer = new Hls({ enableWorker: true, lowLatencyMode: false });
    hlsPlayer.loadSource(browserSafeUrl);
    hlsPlayer.attachMedia(video);
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => { status.textContent = "Evidence stream ready to play."; });
    hlsPlayer.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        status.textContent = "Playback network retry in progress…";
        hlsPlayer?.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        status.textContent = "Playback recovery in progress…";
        hlsPlayer?.recoverMediaError();
      } else {
        status.textContent = "The evidence stream could not be played here. The full VideoDB source link remains available.";
        hlsPlayer?.destroy();
        hlsPlayer = undefined;
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = browserSafeUrl;
    video.addEventListener("loadedmetadata", () => { status.textContent = "Evidence stream ready to play."; }, { once: true });
  } else {
    status.textContent = "This browser does not support HLS playback. Open the full VideoDB source instead.";
  }
}

function timecode(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function render(job) {
  result.hidden = false;
  errorBox.hidden = true;
  document.querySelector("#live-run-id").textContent = `Run ${job.id.slice(0, 8)} · ${job.status}`;
  document.querySelector("#live-stage").textContent = job.stage;
  document.querySelector("#live-progress").style.width = `${job.progress}%`;
  document.querySelector("#live-progress-label").textContent = `${job.progress}% · durable state in Azure Postgres`;
  submit.disabled = job.status === "queued" || job.status === "running";
  if (job.error) showError(job.error);
  const playback = job.evidenceUrl || job.streamUrl;
  const media = document.querySelector("#live-media");
  if (playback) {
    media.hidden = false;
    attachPlayback(playback, job.id);
    const sourceLink = document.querySelector("#live-source-link");
    sourceLink.href = playerUrl(job.streamUrl || playback);
  }
  observations.replaceChildren();
  for (const item of job.observations || []) {
    const entry = document.createElement("li");
    entry.className = "observation";
    const title = item.species && item.species !== "unknown" ? item.species : "Visible scene";
    entry.append(textNode("strong", `${timecode(item.start)} · ${title}${item.count != null ? ` (${item.count})` : ""}`));
    entry.append(textNode("p", item.summary));
    entry.append(textNode("small", `Behavior: ${item.behavior} · Habitat: ${item.environment} · Visible threat: ${item.threat}`, "muted"));
    observations.append(entry);
  }
  document.querySelector("#live-empty").hidden = job.status !== "completed" || Boolean(job.observations?.length);
  if (job.status === "completed" || job.status === "failed") clearInterval(polling);
}

async function loadJob(id) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load observation");
  render(data.job);
  return data.job;
}

function startPolling(id) {
  clearInterval(polling);
  polling = setInterval(() => loadJob(id).catch((error) => showError(error.message)), 5000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  errorBox.hidden = true;
  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceUrl: sourceInput.value, lens: lensInput.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to start observation");
    localStorage.setItem(storageKey, data.job.id);
    render(data.job);
    startPolling(data.job.id);
  } catch (error) {
    submit.disabled = false;
    showError(error instanceof Error ? error.message : "Unable to start observation");
  }
});

document.querySelector("#sample-source").addEventListener("click", () => {
  sourceInput.value = "https://www.youtube.com/watch?v=8oO3QeAZxPc";
  lensInput.value = "habitat";
});
liveTab.addEventListener("click", () => setMode("live"));
preparedTab.addEventListener("click", () => setMode("prepared"));

const saved = localStorage.getItem(storageKey);
if (saved) {
  loadJob(saved).then((job) => {
    if (job.status === "queued" || job.status === "running") startPolling(saved);
  }).catch(() => localStorage.removeItem(storageKey));
}
