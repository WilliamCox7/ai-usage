const providersEl = document.querySelector("#providers");
const statusEl = document.querySelector("#status");
const refreshEl = document.querySelector("#refresh");

refreshEl.addEventListener("click", () => refresh());

refresh();
setInterval(refresh, 5000);
window.aiUsage.onChanged?.(() => refresh());

async function refresh() {
  try {
    const report = await window.aiUsage.read();
    render(report.providers || []);
    statusEl.textContent = `Updated ${new Date(report.generatedAt).toLocaleTimeString()}`;
  } catch (error) {
    providersEl.innerHTML = "";
    statusEl.textContent = error.message || "Unable to read usage.";
    statusEl.classList.add("error");
  }
}

function render(providers) {
  statusEl.classList.remove("error");
  providersEl.replaceChildren(...providers.map(renderProvider));
}

function renderProvider(provider) {
  const card = document.createElement("article");
  card.className = `provider ${provider.id}`;

  const header = document.createElement("div");
  header.className = "header";

  const title = document.createElement("h2");
  title.textContent = provider.label;
  header.append(title);

  const stale = document.createElement("span");
  stale.className = "stale";
  stale.textContent = formatStaleness(provider.rateLimits?.observedAt);
  header.append(stale);

  card.append(header);

  card.append(renderRow("Session", provider.rateLimits?.session));
  card.append(renderRow("Weekly", provider.rateLimits?.weekly));

  return card;
}

function renderRow(label, source) {
  const row = document.createElement("div");
  row.className = "row";

  const labelEl = document.createElement("div");
  labelEl.className = "label";
  labelEl.textContent = label;

  const leftEl = document.createElement("div");
  leftEl.className = "left";
  leftEl.textContent = formatLeft(source);

  const barEl = document.createElement("div");
  barEl.className = "bar";
  if (source?.usedPercent != null) {
    const fillEl = document.createElement("div");
    fillEl.className = "fill";
    fillEl.style.width = `${clamp(source.usedPercent, 0, 100)}%`;
    barEl.append(fillEl);
  } else {
    barEl.classList.add("empty");
  }

  const resetEl = document.createElement("div");
  resetEl.className = "reset";
  resetEl.textContent = source?.resetsAt ? `resets ${formatReset(source.resetsAt)}` : "";

  row.append(labelEl, leftEl, barEl, resetEl);
  return row;
}

function formatLeft(source) {
  if (!source || source.leftPercent == null) return "no data";
  const value = Number(source.leftPercent);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}% left`;
}

function formatStaleness(iso) {
  if (!iso) return "no data";
  const observed = new Date(iso).getTime();
  if (Number.isNaN(observed)) return "no data";
  const diffMs = Date.now() - observed;
  if (diffMs < 60000) return "just now";

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatReset(iso) {
  const reset = new Date(iso);
  const diffMs = reset.getTime() - Date.now();
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
    const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
  }

  return reset.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).replace(":00 ", "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
