const params = new URLSearchParams(window.location.search);
let currentSessionId = params.get("session") || sessionStorage.getItem("smsSessionId");
const storedCode = sessionStorage.getItem("smsCdk") || "";

const els = {
  connection: document.querySelector("#connection"),
  expires: document.querySelector("#expires"),
  phone: document.querySelector("#phone"),
  smsCode: document.querySelector("#sms-code"),
  remaining: document.querySelector("#remaining"),
  state: document.querySelector("#state"),
  smsText: document.querySelector("#sms-text"),
  message: document.querySelector("#message"),
  pollNow: document.querySelector("#poll-now"),
  changePhone: document.querySelector("#change-phone"),
  waitElapsed: document.querySelector("#wait-elapsed"),
  nextPoll: document.querySelector("#next-poll"),
  autoChange: document.querySelector("#auto-change"),
  autoChangeState: document.querySelector("#auto-change-state"),
  historyList: document.querySelector("#history-list")
};

const FAST_POLL_MS = 3500;
const SLOW_POLL_MS = 5000;
const FAST_WINDOW_MS = 30000;
const MAX_WAIT_MS = 120000;

let pollTimer = null;
let clockTimer = null;
let nextPollAt = 0;
let sessionStartedAt = Date.now();
let sessionReady = false;
let completed = false;
let activePolls = 0;
let isChangingPhone = false;
let autoChangeTriggered = false;
let autoChangeEnabled = sessionStorage.getItem("smsAutoChange") === "1";

function setMessage(text, type = "") {
  els.message.textContent = text;
  els.message.className = `message ${type}`.trim();
}

function friendlyError(message = "") {
  const text = String(message || "");
  if (/Missing SMS_API_KEY|API\s*Key|api key|密钥|无效/i.test(text)) return "\u63a5\u53e3\u5bc6\u94a5\u672a\u914d\u7f6e\u6216\u65e0\u6548";
  if (/CDK.*(\u7528\u5b8c|\u6b21\u6570)|\u5df2\u7528\u5b8c|\u7528\u5b8c/.test(text)) return "\u8fd9\u4e2a\u5361\u5bc6\u6b21\u6570\u5df2\u7528\u5b8c";
  if (/\u8fc7\u671f|expired/i.test(text)) return "\u8fd9\u4e2a\u5361\u5bc6\u5df2\u8fc7\u671f";
  if (/\u6682\u65e0|\u65e0\u53ef\u7528|\u6ca1\u6709\u53f7|no available/i.test(text)) return "\u5f53\u524d\u6682\u65e0\u53ef\u7528\u53f7\u7801\uff0c\u7a0d\u540e\u518d\u8bd5";
  if (/\u5df2\u63a5|\u4e0d\u80fd\u6362\u53f7|\u4e0d\u5141\u8bb8\u6362\u53f7/.test(text)) return "\u5df2\u6210\u529f\u63a5\u7801\uff0c\u63a5\u53e3\u4e0d\u5141\u8bb8\u518d\u6362\u53f7";
  if (/429|\u592a\u5feb|rate|frequency/i.test(text)) return "\u8bf7\u6c42\u592a\u5feb\uff0c\u7cfb\u7edf\u4f1a\u7a0d\u540e\u81ea\u52a8\u7ee7\u7eed";
  return text || "\u8bf7\u6c42\u5931\u8d25";
}

function formatRemaining(data) {
  const usedCount = data.usedCount || 0;
  const maxUses = data.maxUses;
  const remaining = data.remaining;

  if (remaining === -1 || remaining === 0) return "\u267e\ufe0f";
  if (typeof remaining === "number") return String(remaining);
  if (maxUses === -1 || maxUses === 0) return "\u267e\ufe0f";
  if (maxUses === undefined || maxUses === null) return "--";
  return `${usedCount}/${maxUses}`;
}

function formatExpiry(timestamp) {
  if (!timestamp) return "\u4f1a\u8bdd\u52a0\u8f7d\u4e2d";
  return `\u4f1a\u8bdd\u6709\u6548\u81f3 ${new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function historyKey() {
  return currentSessionId ? `smsHistory:${currentSessionId}` : "smsHistory";
}

function readHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(historyKey()) || "[]");
  } catch {
    return [];
  }
}

function writeHistory(items) {
  sessionStorage.setItem(historyKey(), JSON.stringify(items.slice(0, 10)));
}

function renderHistory() {
  const items = readHistory();
  els.historyList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "\u6682\u65e0\u9a8c\u8bc1\u7801\u5386\u53f2";
    els.historyList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "history-item";

    const code = document.createElement("span");
    code.className = "history-code";
    code.textContent = item.code || "--";

    const text = document.createElement("span");
    text.className = "history-text";
    text.textContent = item.sms || "\u77ed\u4fe1\u5df2\u6536\u5230";

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = new Date(item.time).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    row.append(code, text, time);
    els.historyList.appendChild(row);
  }
}

function addHistory(data) {
  if (!data.code && !data.sms) return;
  const items = readHistory();
  const signature = `${data.code || ""}|${data.sms || ""}`;
  if (items[0]?.signature === signature) return;

  items.unshift({
    signature,
    code: data.code || "",
    sms: data.sms || "",
    time: Date.now()
  });
  writeHistory(items);
  renderHistory();
}

function setAutoChange(enabled) {
  autoChangeEnabled = enabled;
  sessionStorage.setItem("smsAutoChange", enabled ? "1" : "0");
  els.autoChange.checked = enabled;
  els.autoChangeState.textContent = enabled ? "\u5f00" : "\u5173";
}

function getPollDelay() {
  const elapsed = Date.now() - sessionStartedAt;
  return elapsed < FAST_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}

function updateClock() {
  els.waitElapsed.textContent = formatDuration(Date.now() - sessionStartedAt);

  if (completed || !nextPollAt) {
    els.nextPoll.textContent = completed ? "\u5df2\u505c\u6b62" : "--";
  } else {
    const waitSeconds = Math.max(0, Math.ceil((nextPollAt - Date.now()) / 1000));
    els.nextPoll.textContent = waitSeconds ? `${waitSeconds}s` : "\u5373\u5c06";
  }

  if (sessionReady && !completed && Date.now() - sessionStartedAt >= MAX_WAIT_MS) {
    if (autoChangeEnabled && !autoChangeTriggered && !isChangingPhone) {
      autoChangeTriggered = true;
      changePhone(true);
    } else if (!autoChangeEnabled) {
      setMessage("\u5df2\u7b49\u5f85 120 \u79d2\uff0c\u53ef\u4ee5\u624b\u52a8\u6362\u53f7", "error");
    }
  }
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  nextPollAt = 0;
  updateClock();
}

function scheduleNextPoll(delay = getPollDelay()) {
  stopPolling();
  if (!sessionReady || completed || document.hidden) return;

  nextPollAt = Date.now() + delay;
  updateClock();
  pollTimer = setTimeout(() => pollSms(false), delay);
}

function startPolling() {
  if (sessionReady && !completed) scheduleNextPoll(0);
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (!response.ok && response.status !== 429) {
      const error = new Error(friendlyError(data.error || "\u8bf7\u6c42\u5931\u8d25"));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function render(data) {
  sessionReady = true;
  if (data.phone) els.phone.textContent = data.phone;
  els.remaining.textContent = formatRemaining(data);
  els.expires.textContent = formatExpiry(data.expiresAt);
  if (data.createdAt) sessionStartedAt = data.createdAt;

  completed = Boolean(data.completed || data.code);
  if (completed) {
    els.connection.textContent = "\u5df2\u6536\u5230";
    els.connection.className = "status-badge success";
    els.state.textContent = "\u5b8c\u6210";
    els.smsCode.textContent = data.code || "\u5df2\u6536\u5230";
    els.smsText.textContent = data.sms || "\u77ed\u4fe1\u5df2\u6536\u5230";
    els.changePhone.disabled = true;
    els.changePhone.title = "\u5df2\u63a5\u7801\uff0c\u63a5\u53e3\u4e0d\u5141\u8bb8\u6362\u53f7";
    addHistory(data);
    stopPolling();
  } else {
    els.connection.textContent = "\u7b49\u5f85\u4e2d";
    els.connection.className = "status-badge pending";
    els.state.textContent = "\u81ea\u52a8\u67e5\u8be2";
    els.smsCode.textContent = "\u7b49\u5f85\u4e2d";
    els.changePhone.disabled = false;
    els.changePhone.title = "";
    if (data.sms) els.smsText.textContent = data.sms;
  }
  updateClock();
}

async function recoverSession() {
  if (!storedCode) return false;

  try {
    setMessage("\u4f1a\u8bdd\u5df2\u8fc7\u671f\uff0c\u6b63\u5728\u5c1d\u8bd5\u6062\u590d...");
    const data = await requestJson("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: storedCode })
    });
    if (!data.ok || !data.sessionId) return false;

    currentSessionId = data.sessionId;
    sessionStorage.setItem("smsSessionId", data.sessionId);
    window.history.replaceState({}, "", `/detail.html?session=${encodeURIComponent(data.sessionId)}`);
    sessionStartedAt = Date.now();
    autoChangeTriggered = false;
    await loadSession(false);
    return true;
  } catch {
    return false;
  }
}

async function loadSession(allowRecover = true) {
  if (!currentSessionId) {
    const recovered = allowRecover ? await recoverSession() : false;
    if (recovered) return;

    setMessage("\u7f3a\u5c11\u4f1a\u8bdd\uff0c\u8bf7\u91cd\u65b0\u5151\u6362", "error");
    els.connection.textContent = "\u672a\u8fde\u63a5";
    els.connection.className = "status-badge";
    sessionReady = false;
    stopPolling();
    return;
  }

  try {
    const data = await requestJson(`/api/session?session=${encodeURIComponent(currentSessionId)}`);
    if (!data.ok) throw new Error(friendlyError(data.error || "\u4f1a\u8bdd\u4e0d\u53ef\u7528"));
    render(data);
  } catch (error) {
    if (error.status === 404 && allowRecover && await recoverSession()) return;
    setMessage(error.message || "\u4f1a\u8bdd\u52a0\u8f7d\u5931\u8d25", "error");
    els.connection.textContent = "\u5df2\u65ad\u5f00";
    els.connection.className = "status-badge";
    sessionReady = false;
    stopPolling();
  }
}

async function pollSms(manual = false) {
  if (!sessionReady || !currentSessionId || (activePolls > 0 && !manual) || (completed && !manual)) return;

  activePolls += 1;
  if (manual) {
    setMessage("\u6b63\u5728\u67e5\u8be2...");
    els.pollNow.disabled = true;
  }

  try {
    const data = await requestJson("/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: currentSessionId, force: manual })
    });

    if (!data.ok && data.retry_after) {
      const cooldownMs = Math.max(1000, Number(data.retry_after) * 1000);
      if (manual) setMessage(friendlyError(data.error), "error");
      scheduleNextPoll(cooldownMs);
      return;
    }

    render(data);

    if (data.ok) {
      setMessage("\u9a8c\u8bc1\u7801\u5df2\u6536\u5230", "success");
      stopPolling();
    } else if (data.pending) {
      if (manual) setMessage("\u6682\u672a\u6536\u5230\u77ed\u4fe1\uff0c\u7ee7\u7eed\u7b49\u5f85");
      scheduleNextPoll(getPollDelay());
    } else {
      setMessage(friendlyError(data.error || "\u6682\u672a\u6536\u5230\u77ed\u4fe1"));
      scheduleNextPoll(getPollDelay());
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setMessage("\u8bf7\u6c42\u8d85\u65f6\uff0c\u7ee7\u7eed\u7b49\u5f85", "error");
    } else {
      setMessage(error.message || "\u67e5\u8be2\u5931\u8d25", "error");
    }
    if (!completed) scheduleNextPoll(getPollDelay());
  } finally {
    activePolls = Math.max(0, activePolls - 1);
    if (manual) els.pollNow.disabled = false;
  }
}

async function changePhone(auto = false) {
  if (!currentSessionId || completed || isChangingPhone) return;

  isChangingPhone = true;
  els.changePhone.disabled = true;
  els.changePhone.classList.add("button-loading");
  setMessage(auto ? "\u7b49\u5f85\u8d85\u65f6\uff0c\u6b63\u5728\u81ea\u52a8\u6362\u53f7..." : "\u6b63\u5728\u6362\u53f7...");

  try {
    const data = await requestJson("/api/change-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: currentSessionId })
    });
    if (!data.ok) throw new Error(friendlyError(data.error || "\u6362\u53f7\u5931\u8d25"));

    sessionStartedAt = Date.now();
    autoChangeTriggered = false;
    completed = false;
    els.smsCode.textContent = "\u7b49\u5f85\u4e2d";
    els.smsText.textContent = "\u6682\u672a\u6536\u5230\u77ed\u4fe1\uff0c\u7cfb\u7edf\u4f1a\u81ea\u52a8\u67e5\u8be2\u3002";
    render(data);
    setMessage("\u5df2\u66f4\u6362\u624b\u673a\u53f7", "success");
    scheduleNextPoll(0);
  } catch (error) {
    setMessage(error.message || "\u6362\u53f7\u5931\u8d25", "error");
  } finally {
    isChangingPhone = false;
    els.changePhone.classList.remove("button-loading");
    if (!completed) els.changePhone.disabled = false;
  }
}

function copyValue(type) {
  const value = type === "phone" ? els.phone.textContent : els.smsCode.textContent;
  if (!value || value === "--" || value === "\u7b49\u5f85\u4e2d") {
    setMessage("\u6682\u65e0\u53ef\u590d\u5236\u5185\u5bb9", "error");
    return;
  }

  const cleanValue = type === "phone" ? value.replace(/^\+\d+\s*/, "") : value;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(cleanValue)
      .then(() => setMessage("\u5df2\u590d\u5236", "success"))
      .catch(() => fallbackCopy(cleanValue));
  } else {
    fallbackCopy(cleanValue);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    setMessage("\u5df2\u590d\u5236", "success");
  } catch (err) {
    setMessage("\u590d\u5236\u5931\u8d25", "error");
  }
  document.body.removeChild(textarea);
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyValue(button.dataset.copy));
});

els.pollNow.addEventListener("click", () => pollSms(true));
els.changePhone.addEventListener("click", () => changePhone(false));
els.autoChange.addEventListener("change", () => setAutoChange(els.autoChange.checked));

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
  } else if (!completed) {
    scheduleNextPoll(0);
  }
});

setAutoChange(autoChangeEnabled);
renderHistory();
clockTimer = setInterval(updateClock, 1000);
updateClock();

loadSession().then(() => {
  if (sessionReady && !completed) startPolling();
});
