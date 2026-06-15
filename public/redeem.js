const form = document.querySelector("#redeem-form");
const message = document.querySelector("#message");
const submitButton = form.querySelector("button[type='submit']");
const codeInput = form.querySelector("#code");

let isSubmitting = false;

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function setButtonState(disabled) {
  submitButton.disabled = disabled;
  if (!disabled) {
    isSubmitting = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // \u9632\u6b62\u91cd\u590d\u63d0\u4ea4
  if (isSubmitting) {
    return;
  }

  const code = new FormData(form).get("code").trim();
  if (!code) {
    setMessage("\u8bf7\u8f93\u5165 CDK", "error");
    return;
  }

  isSubmitting = true;
  setButtonState(true);
  setMessage("\u6b63\u5728\u67e5\u770b\u53f7\u7801...");

  // \u6e05\u9664\u65e7\u7684session
  sessionStorage.removeItem("smsSessionId");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "\u5151\u6362\u5931\u8d25");
    }

    sessionStorage.setItem("smsSessionId", data.sessionId);
    setMessage("\u5df2\u5206\u914d\u53f7\u7801\uff0c\u6b63\u5728\u8fdb\u5165\u8be6\u60c5", "success");

    // \u5ef6\u8fdf\u8df3\u8f6c\uff0c\u786e\u4fdd\u7528\u6237\u770b\u5230\u6210\u529f\u6d88\u606f
    setTimeout(() => {
      window.location.href = `/detail.html?session=${encodeURIComponent(data.sessionId)}`;
    }, 300);
  } catch (error) {
    if (error.name === 'AbortError') {
      setMessage("\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u91cd\u8bd5", "error");
    } else {
      setMessage(error.message || "\u5151\u6362\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5", "error");
    }
    setButtonState(false);
    isSubmitting = false;
  }
});

// \u8f93\u5165\u65f6\u6e05\u9664\u9519\u8bef\u6d88\u606f
codeInput.addEventListener("input", () => {
  if (message.classList.contains("error")) {
    setMessage("");
  }
});
