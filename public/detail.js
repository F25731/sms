const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session") || sessionStorage.getItem("smsSessionId");

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
  changePhone: document.querySelector("#change-phone")
};

let timer = null;
let completed = false;
let isPolling = false;
let isChangingPhone = false;
let pollInterval = 3000; // \u9ed8\u8ba43\u79d2\u8f6e\u8be2

function setMessage(text, type = "") {
  els.message.textContent = text;
  els.message.className = `message ${type}`.trim();
}

function formatRemaining(value) {
  if (value === -1) return "\u65e0\u9650";
  if (value === undefined || value === null || value === "") return "--";
  return String(value);
}

function formatExpiry(timestamp) {
  if (!timestamp) return "\u4f1a\u8bdd\u52a0\u8f7d\u4e2d";
  return `\u4f1a\u8bdd\u6709\u6548\u81f3 ${new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function render(data) {
  els.phone.textContent = data.phone || "--";
  els.remaining.textContent = formatRemaining(data.remaining);
  els.expires.textContent = formatExpiry(data.expiresAt);

  completed = Boolean(data.completed || data.code);
  if (completed) {
    els.connection.textContent = "\u5df2\u6536\u5230";
    els.connection.className = "status-badge success";
    els.state.textContent = "\u5b8c\u6210";
    els.smsCode.textContent = data.code || "\u5df2\u6536\u5230";
    els.smsText.textContent = data.sms || "\u77ed\u4fe1\u5df2\u6536\u5230";
    els.changePhone.disabled = true;
    els.pollNow.disabled = true;
    stopPolling();
  } else {
    els.connection.textContent = "\u7b49\u5f85\u4e2d";
    els.connection.className = "status-badge pending";
    els.state.textContent = "\u81ea\u52a8\u67e5\u8be2";
    els.smsCode.textContent = "\u7b49\u5f85\u4e2d";
    if (data.sms) els.smsText.textContent = data.sms;
  }
}

function stopPolling() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startPolling() {
  stopPolling();
  if (!completed) {
    pollSms();
    timer = setInterval(() => pollSms(), pollInterval);
  }
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
      throw new Error(data.error || "\u8bf7\u6c42\u5931\u8d25");
    }
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function loadSession() {
  if (!sessionId) {
    setMessage("\u7f3a\u5c11\u4f1a\u8bdd\uff0c\u8bf7\u91cd\u65b0\u5151\u6362", "error");
    els.connection.textContent = "\u672a\u8fde\u63a5";
    els.connection.className = "status-badge";
    return;
  }

  try {
    const data = await requestJson(`/api/session?session=${encodeURIComponent(sessionId)}`);
    if (!data.ok) throw new Error(data.error || "\u4f1a\u8bdd\u4e0d\u53ef\u7528");
    render(data);
  } catch (error) {
    setMessage(error.message || "\u4f1a\u8bdd\u52a0\u8f7d\u5931\u8d25", "error");
    els.connection.textContent = "\u5df2\u65ad\u5f00";
    els.connection.className = "status-badge";
  }
}

async function pollSms(manual = false) {
  if (!sessionId || completed || isPolling) return;

  isPolling = true;
  if (manual) {
    setMessage("\u6b63\u5728\u67e5\u8be2...");
    els.pollNow.disabled = true;
    els.pollNow.classList.add("button-loading");
  }

  try {
    const data = await requestJson("/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId })
    });

    render(data);

    if (data.ok) {
      setMessage("\u9a8c\u8bc1\u7801\u5df2\u6536\u5230", "success");
      stopPolling();
    } else if (data.pending) {
      if (manual) {
        setMessage("\u6682\u672a\u6536\u5230\u77ed\u4fe1\uff0c\u7ee7\u7eed\u7b49\u5f85");
      }
    } else {
      setMessage(data.error || "\u6682\u672a\u6536\u5230\u77ed\u4fe1");
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      setMessage("\u8bf7\u6c42\u8d85\u65f6\uff0c\u7ee7\u7eed\u7b49\u5f85", "error");
    } else {
      setMessage(error.message || "\u67e5\u8be2\u5931\u8d25", "error");
    }
  } finally {
    isPolling = false;
    if (manual && !completed) {
      els.pollNow.disabled = false;
      els.pollNow.classList.remove("button-loading");
    }
  }
}

async function changePhone() {
  if (!sessionId || completed || isChangingPhone) return;

  isChangingPhone = true;
  els.changePhone.disabled = true;
  els.changePhone.classList.add("button-loading");
  setMessage("\u6b63\u5728\u6362\u53f7...");

  try {
    const data = await requestJson("/api/change-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId })
    });
    if (!data.ok) throw new Error(data.error || "\u6362\u53f7\u5931\u8d25");
    render(data);
    setMessage("\u5df2\u66f4\u6362\u624b\u673a\u53f7", "success");

    // \u6362\u53f7\u540e\u7acb\u5373\u8f6e\u8be2
    pollSms();
  } catch (error) {
    setMessage(error.message || "\u6362\u53f7\u5931\u8d25", "error");
  } finally {
    isChangingPhone = false;
    els.changePhone.classList.remove("button-loading");
    if (!completed) {
      els.changePhone.disabled = false;
    }
  }
}

function copyValue(type) {
  const value = type === "phone" ? els.phone.textContent : els.smsCode.textContent;
  if (!value || value === "--" || value === "\u7b49\u5f85\u4e2d") {
    setMessage("\u6682\u65e0\u53ef\u590d\u5236\u5185\u5bb9", "error");
    return;
  }

  // \u53bb\u9664\u624b\u673a\u53f7\u7684\u56fd\u5bb6\u4ee3\u7801\u524d\u7f00\uff08\u5982\u679c\u6709\uff09
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

// \u4e8b\u4ef6\u76d1\u542c
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyValue(button.dataset.copy));
});

els.pollNow.addEventListener("click", () => pollSms(true));
els.changePhone.addEventListener("click", changePhone);

// \u9875\u9762\u53ef\u89c1\u6027\u53d8\u5316\u65f6\u7ba1\u7406\u8f6e\u8be2
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
  } else if (!completed) {
    startPolling();
  }
});

// \u521d\u59cb\u5316
loadSession().then(() => {
  if (!completed) {
    startPolling();
  }
});
