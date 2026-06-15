const form = document.querySelector("#redeem-form");
const message = document.querySelector("#message");
const submitButton = form.querySelector("button[type='submit']");

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const code = new FormData(form).get("code").trim();
  if (!code) {
    setMessage("\u8bf7\u8f93\u5165 CDK", "error");
    return;
  }

  submitButton.disabled = true;
  setMessage("\u6b63\u5728\u67e5\u770b\u53f7\u7801...");

  try {
    const response = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "\u5151\u6362\u5931\u8d25");
    }

    sessionStorage.setItem("smsSessionId", data.sessionId);
    setMessage("\u5df2\u5206\u914d\u53f7\u7801\uff0c\u6b63\u5728\u8fdb\u5165\u8be6\u60c5", "success");
    window.location.href = `/detail.html?session=${encodeURIComponent(data.sessionId)}`;
  } catch (error) {
    setMessage(error.message || "\u5151\u6362\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5", "error");
    submitButton.disabled = false;
  }
});
