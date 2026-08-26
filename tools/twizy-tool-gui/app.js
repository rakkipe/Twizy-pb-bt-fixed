const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let port;
let reader;
let readLoopActive = false;
let receiveBuffer = "";
let logLines = [];
let armedUntil = 0;
let armTimer;

const terminal = $("#terminal");
const connectButton = $("#connectButton");
const disconnectButton = $("#disconnectButton");
const badge = $("#connectionBadge");
const safetyCheck = $("#safetyCheck");
const safetyCode = $("#safetyCode");
const armButton = $("#armButton");
const applyButton = $("#applyButton");
const armHint = $("#armHint");
const applyDialog = $("#applyDialog");

function appendLog(text, direction = "rx") {
  const stamp = new Date().toLocaleTimeString("nl-BE", { hour12: false });
  const line = `[${stamp}] ${direction === "tx" ? "→" : "←"} ${text}`;
  logLines.push(line);
  if (logLines.length > 4000) logLines = logLines.slice(-3000);
  terminal.textContent = logLines.join("\n");
  terminal.scrollTop = terminal.scrollHeight;
}

function setConnected(connected) {
  connectButton.disabled = connected;
  disconnectButton.disabled = !connected;
  badge.className = `badge ${connected ? "online" : "offline"}`;
  badge.querySelector("span").textContent = connected ? "USB verbonden" : "Niet verbonden";
  if (!connected) {
    armedUntil = 0;
    clearInterval(armTimer);
  }
  refreshSafety();
}

function parseLine(line) {
  const status = line.match(/heartbeat=(0x[0-9A-Fa-f]+).*speed=([-\d.]+|nan).*neutral=(yes|no)/);
  if (status) {
    $("#heartbeatValue").textContent = status[1].toUpperCase();
    $("#speedValue").textContent = Number.isFinite(Number(status[2])) ? Number(status[2]).toFixed(2) : "—";
    $("#neutralValue").textContent = status[3] === "yes" ? "NEUTRAL" : "NIET NEUTRAL";
  }

  const identity = line.match(/(?:product\s+)?0x1018\.02\s*=\s*0x([0-9A-Fa-f]{8})/i);
  if (identity) {
    $("#controllerValue").textContent = identity[1].toUpperCase();
    $("#controllerValue").style.color =
      identity[1].toUpperCase() === "0712302D" ? "var(--lime)" : "var(--red)";
  }
}

async function readLoop() {
  const decoder = new TextDecoder();
  readLoopActive = true;
  try {
    while (port?.readable && readLoopActive) {
      reader = port.readable.getReader();
      try {
        while (readLoopActive) {
          const { value, done } = await reader.read();
          if (done) break;
          receiveBuffer += decoder.decode(value, { stream: true });
          const lines = receiveBuffer.split(/\r?\n/);
          receiveBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            appendLog(line);
            parseLine(line);
          }
        }
      } finally {
        reader.releaseLock();
        reader = undefined;
      }
    }
  } catch (error) {
    if (readLoopActive) appendLog(`Leesfout: ${error.message}`, "system");
  } finally {
    if (readLoopActive) await disconnectSerial();
  }
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("Web Serial wordt niet ondersteund. Open deze GUI in de nieuwste Chrome of Edge via localhost.");
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200, bufferSize: 4096 });
    setConnected(true);
    appendLog("M5StickC Plus2 verbonden op 115200 baud", "system");
    readLoop();
    setTimeout(() => sendCommand("status"), 350);
  } catch (error) {
    appendLog(`Verbinding mislukt: ${error.message}`, "system");
  }
}

async function disconnectSerial() {
  readLoopActive = false;
  try {
    if (reader) await reader.cancel();
  } catch (_) {}
  try {
    if (port?.readable?.locked || port?.writable?.locked) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (port) await port.close();
  } catch (_) {}
  port = undefined;
  setConnected(false);
  appendLog("USB-verbinding gesloten", "system");
}

async function sendCommand(command) {
  const clean = command.trim();
  if (!clean) return;
  if (!port?.writable) {
    alert("Verbind eerst de M5StickC Plus2 via USB.");
    return;
  }

  const writer = port.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${clean}\n`));
    appendLog(clean, "tx");
  } finally {
    writer.releaseLock();
  }
}

function validHex(value, length) {
  return new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value.trim());
}

function refreshSafety() {
  const prerequisites =
    Boolean(port?.writable) &&
    safetyCheck.checked &&
    safetyCode.value.trim() === "V12";
  armButton.disabled = !prerequisites;

  const seconds = Math.max(0, Math.ceil((armedUntil - Date.now()) / 1000));
  applyButton.disabled = !prerequisites || seconds === 0;
  armHint.textContent = seconds
    ? `Software-arm actief: nog ${seconds} seconden. APPLY is eenmalig.`
    : "Houd eerst Button A drie seconden vast en klik daarna ARM V12.";
}

function startArmWindow() {
  armedUntil = Date.now() + 60000;
  clearInterval(armTimer);
  armTimer = setInterval(() => {
    refreshSafety();
    if (Date.now() >= armedUntil) clearInterval(armTimer);
  }, 500);
  refreshSafety();
}

connectButton.addEventListener("click", connectSerial);
disconnectButton.addEventListener("click", disconnectSerial);

$$("[data-command]").forEach((button) => {
  button.addEventListener("click", () => sendCommand(button.dataset.command));
});

$$("[data-read]").forEach((button) => {
  button.addEventListener("click", () => sendCommand(`read ${button.dataset.read}`));
});

$("#readForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const index = $("#readIndex").value.trim();
  const sub = $("#readSub").value.trim();
  if (!validHex(index, 4) || !validHex(sub, 2)) {
    alert("Gebruik vier hextekens voor de index en twee voor de subindex.");
    return;
  }
  sendCommand(`read ${index} ${sub}`);
});

$("#queueForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const index = $("#queueIndex").value.trim();
  const sub = $("#queueSub").value.trim();
  const value = $("#queueValue").value.trim();
  if (!validHex(index, 4) || !validHex(sub, 2) || !/^(?:0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    alert("Controleer index, subindex en waarde. Waarde is decimaal of 0x-hex.");
    return;
  }
  sendCommand(`queue ${index} ${sub} ${value}`);
});

$("#manualForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#manualCommand");
  sendCommand(input.value);
  input.value = "";
});

safetyCheck.addEventListener("change", refreshSafety);
safetyCode.addEventListener("input", refreshSafety);

armButton.addEventListener("click", async () => {
  await sendCommand("arm V12");
  startArmWindow();
});

applyButton.addEventListener("click", () => applyDialog.showModal());

applyDialog.addEventListener("close", async () => {
  if (applyDialog.returnValue !== "confirm") return;
  applyDialog.returnValue = "";
  armedUntil = 0;
  clearInterval(armTimer);
  refreshSafety();
  await sendCommand("apply");
});

$("#clearLogButton").addEventListener("click", () => {
  logLines = [];
  terminal.textContent = "";
});

$("#downloadLogButton").addEventListener("click", () => {
  const blob = new Blob([logLines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `twizy-tool-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  link.click();
  URL.revokeObjectURL(link.href);
});

navigator.serial?.addEventListener("disconnect", (event) => {
  if (event.target === port) disconnectSerial();
});

setConnected(false);
