const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let port;
let reader;
let readLoopActive = false;
let receiveBuffer = "";
let logLines = [];
let armedUntil = 0;
let armTimer;
let elmBuffer = "";
let elmPending = null;
let vlinkerInfo = "—";
const localQueue = [];

const adapterMode = () => $("#adapterMode").value;

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
  $("#adapterMode").disabled = connected;
  if (!connected) {
    armedUntil = 0;
    clearInterval(armTimer);
  }
  refreshMode();
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
          const decoded = decoder.decode(value, { stream: true });
          if (adapterMode() === "vlinker") {
            elmBuffer += decoded;
            const prompt = elmBuffer.indexOf(">");
            if (prompt >= 0 && elmPending) {
              const response = elmBuffer.slice(0, prompt);
              elmBuffer = elmBuffer.slice(prompt + 1);
              const pending = elmPending;
              elmPending = null;
              clearTimeout(pending.timer);
              response.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean)
                .forEach((line) => appendLog(line));
              pending.resolve(response);
            }
            continue;
          }
          receiveBuffer += decoded;
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
    appendLog(adapterMode() === "vlinker"
      ? "VLinker USB verbonden op 115200 baud"
      : "M5StickC Plus2 verbonden op 115200 baud", "system");
    readLoop();
    if (adapterMode() === "vlinker") {
      await initializeVlinker();
    } else {
      setTimeout(() => sendCommand("status"), 350);
    }
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
  if (elmPending) {
    clearTimeout(elmPending.timer);
    elmPending.reject(new Error("USB-verbinding gesloten"));
    elmPending = null;
  }
  port = undefined;
  refreshMode();
setConnected(false);
  appendLog("USB-verbinding gesloten", "system");
}

async function writeSerialLine(line) {
  if (!port?.writable) throw new Error("Geen USB-verbinding");
  const writer = port.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${line}\\r`));
    appendLog(line, "tx");
  } finally {
    writer.releaseLock();
  }
}

function elmCommand(command, timeout = 1800) {
  if (elmPending) return Promise.reject(new Error("VLinker is nog bezig"));
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      if (elmPending) elmPending = null;
      reject(new Error(`Geen VLinker-antwoord op ${command}`));
    }, timeout);
    elmPending = { resolve, reject, timer };
    try {
      await writeSerialLine(command);
    } catch (error) {
      clearTimeout(timer);
      elmPending = null;
      reject(error);
    }
  });
}

function elmClean(response) {
  return response.toUpperCase().replace(/SEARCHING\\.\\.\\./g, "")
    .split(/\\r?\\n/).map((line) => line.replace(/\\s/g, ""))
    .filter((line) => line && line !== "OK");
}

async function initializeVlinker() {
  try {
    await elmCommand("ATZ", 3000);
    const identity = await elmCommand("ATI");
    vlinkerInfo = identity.split(/\\r?\\n/).map((x) => x.trim())
      .find((x) => /VLINK|ELM|STN/i.test(x)) || "ELM/STN USB";
    for (const command of ["ATE0", "ATL0", "ATS0", "ATH1", "ATCAF0", "ATCFC0", "ATSP6", "ATST32"]) {
      const response = await elmCommand(command);
      if (/\\?|ERROR|UNABLE/i.test(response)) throw new Error(`${command} niet ondersteund`);
    }
    appendLog(`VLinker klaar: ${vlinkerInfo}; CAN 11-bit/500 kbit/s; read-only`, "system");
    refreshMode();
    await vlinkerIdentify();
  } catch (error) {
    appendLog(`VLinker-initialisatie mislukt: ${error.message}`, "system");
  }
}

function sdoPayload(response) {
  const line = elmClean(response).find((item) => item.startsWith("581") && item.length >= 19);
  return line ? line.slice(3, 19) : null;
}

async function vlinkerSdoRead(index, sub) {
  const idx = Number.parseInt(index, 16);
  const si = Number.parseInt(sub, 16);
  await elmCommand("ATSH601");
  const frame = `40${(idx & 0xff).toString(16).padStart(2, "0")}${(idx >> 8).toString(16).padStart(2, "0")}${si.toString(16).padStart(2, "0")}00000000`.toUpperCase();
  const response = await elmCommand(frame);
  const payload = sdoPayload(response);
  if (!payload) throw new Error(`Geen SDO 0x581-antwoord voor ${index}.${sub}`);
  const command = payload.slice(0, 2);
  const returnedIndex = payload.slice(4, 6) + payload.slice(2, 4);
  const returnedSub = payload.slice(6, 8);
  if (returnedIndex !== index.toUpperCase() || returnedSub !== sub.toUpperCase()) {
    throw new Error("SDO-antwoord hoort bij een ander object");
  }
  const bytes = [payload.slice(8,10), payload.slice(10,12), payload.slice(12,14), payload.slice(14,16)];
  const value = (Number.parseInt(bytes[0],16) |
    (Number.parseInt(bytes[1],16) << 8) |
    (Number.parseInt(bytes[2],16) << 16) |
    (Number.parseInt(bytes[3],16) << 24)) >>> 0;
  if (command === "80") throw new Error(`SDO abort 0x${value.toString(16).padStart(8,"0")}`);
  if (!["4F","4B","47","43"].includes(command)) throw new Error(`Onverwacht SDO-commando 0x${command}`);
  appendLog(`0x${index.toUpperCase()}.${sub.toUpperCase()} = 0x${value.toString(16).padStart(8,"0").toUpperCase()} (${value})`, "system");
  return value;
}

async function vlinkerIdentify() {
  const labels = ["vendor", "product", "revision", "serial"];
  for (let sub = 1; sub <= 4; sub++) {
    const value = await vlinkerSdoRead("1018", sub.toString(16).padStart(2,"0"));
    appendLog(`${labels[sub-1]} = 0x${value.toString(16).padStart(8,"0").toUpperCase()}`, "system");
    if (sub === 2) {
      const pid = value.toString(16).padStart(8,"0").toUpperCase();
      $("#controllerValue").textContent = pid;
      $("#controllerValue").style.color = pid === "0712302D" ? "var(--lime)" : "var(--red)";
    }
  }
}

async function vlinkerFaults() {
  const count = Math.min(32, await vlinkerSdoRead("1003", "00"));
  appendLog(`Foutgeschiedenis: ${count} item(s)`, "system");
  for (let sub = 1; sub <= count; sub++) {
    await vlinkerSdoRead("1003", sub.toString(16).padStart(2,"0"));
  }
}

async function handleVlinkerCommand(command) {
  const [name, a, b, ...rest] = command.trim().split(/\\s+/);
  if (name === "identify") return vlinkerIdentify();
  if (name === "faults") return vlinkerFaults();
  if (name === "diagnose") {
    appendLog("VLinker-diagnose: adapter, identiteit en foutlog", "system");
    await vlinkerIdentify();
    return vlinkerFaults();
  }
  if (name === "status") {
    appendLog(`Adapter=${vlinkerInfo}; CAN=11/500; directe VLinker-modus=read-only`, "system");
    return vlinkerSdoRead("5110", "00");
  }
  if (name === "read" && validHex(a || "",4) && validHex(b || "",2)) return vlinkerSdoRead(a,b);
  if (name === "queue" && validHex(a || "",4) && validHex(b || "",2) && rest.length) {
    localQueue.push({ index:a.toUpperCase(), sub:b.toUpperCase(), value:rest.join(" ") });
    appendLog(`Lokaal queued 0x${a.toUpperCase()}.${b.toUpperCase()} = ${rest.join(" ")} (read-only)`, "system");
    return;
  }
  if (name === "show") {
    if (!localQueue.length) return appendLog("Lokale VLinker-wachtrij is leeg", "system");
    localQueue.forEach((item,i) => appendLog(`${i}: 0x${item.index}.${item.sub} = ${item.value}`, "system"));
    return;
  }
  if (name === "inspect") {
    for (const item of localQueue) {
      const current = await vlinkerSdoRead(item.index,item.sub);
      appendLog(`inspect 0x${item.index}.${item.sub}: huidig=${current}, gevraagd=${item.value}`, "system");
    }
    return;
  }
  if (name === "clear") {
    localQueue.length = 0;
    return appendLog("Lokale VLinker-wachtrij gewist", "system");
  }
  if (name === "help") {
    return appendLog("VLinker: status, identify, faults, diagnose, read, queue, show, inspect, clear. Writes blijven uitgeschakeld.", "system");
  }
  if (name === "arm" || name === "apply") throw new Error("Writes zijn in VLinker-modus nog uitgeschakeld");
  throw new Error(`Onbekend of ongeldig VLinker-commando: ${command}`);
}

async function sendCommand(command) {
  const clean = command.trim();
  if (!clean) return;
  if (!port?.writable) {
    alert("Verbind eerst het USB-apparaat.");
    return;
  }
  try {
    if (adapterMode() === "vlinker") return await handleVlinkerCommand(clean);
    await writeSerialLine(clean);
  } catch (error) {
    appendLog(error.message, "system");
  }
}

function validHex(value, length) {
  return new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value.trim());
}

function refreshMode() {
  const vlinker = adapterMode() === "vlinker";
  $("#fourthMetricLabel").textContent = vlinker ? "Adapter" : "Heartbeat";
  $("#fourthMetricHint").textContent = vlinker ? "ELM327/STN via USB" : "SEVCON node 1";
  $("#heartbeatValue").textContent = vlinker ? vlinkerInfo : "—";
  $("#vlinkerWriteNotice").classList.toggle("hidden", !vlinker);
  $(".danger-card").classList.toggle("vlinker-readonly", vlinker);
}

function refreshSafety() {
  const prerequisites =
    adapterMode() === "m5" &&
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

$("#adapterMode").addEventListener("change", () => {
  vlinkerInfo = "—";
  localQueue.length = 0;
  refreshMode();
  refreshSafety();
});

navigator.serial?.addEventListener("disconnect", (event) => {
  if (event.target === port) disconnectSerial();
});

setConnected(false);
