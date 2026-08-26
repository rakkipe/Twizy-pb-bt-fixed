#include <Arduino.h>
#include <driver/twai.h>

namespace {

constexpr gpio_num_t CAN_TX_PIN = GPIO_NUM_32;
constexpr gpio_num_t CAN_RX_PIN = GPIO_NUM_33;
constexpr int BUTTON_A_PIN = 37;
constexpr uint32_t CAN_BITRATE = 500000;
constexpr uint32_t SDO_REQUEST_ID = 0x601;
constexpr uint32_t SDO_RESPONSE_ID = 0x581;
constexpr uint32_t NMT_ID = 0x000;
constexpr uint32_t HEARTBEAT_ID = 0x701;
constexpr uint32_t STATUS_ID = 0x59B;
constexpr uint32_t SPEED_ID = 0x599;
constexpr size_t MAX_QUEUE = 64;

struct SdoResult {
  bool ok = false;
  bool aborted = false;
  uint32_t value = 0;
  uint32_t abortCode = 0;
  uint8_t responseCommand = 0;
};

struct QueuedWrite {
  uint16_t index = 0;
  uint8_t sub = 0;
  uint32_t value = 0;
  uint32_t original = 0;
  bool snapshotValid = false;
  bool written = false;
};

QueuedWrite queueItems[MAX_QUEUE];
size_t queueSize = 0;

uint8_t heartbeatState = 0xFF;
uint32_t heartbeatSeenAt = 0;
bool neutral = false;
float speedKph = NAN;
uint32_t safetySeenAt = 0;

uint32_t physicalArmUntil = 0;
uint32_t writeArmUntil = 0;
bool buttonWasDown = false;
bool buttonHoldAnnounced = false;
uint32_t buttonDownAt = 0;

bool deadlineActive(uint32_t deadline) {
  return deadline != 0 && int32_t(deadline - millis()) > 0;
}

void consumeVehicleFrame(const twai_message_t& message) {
  if (message.flags & TWAI_MSG_FLAG_EXTD) return;

  if (message.identifier == HEARTBEAT_ID && message.data_length_code >= 1) {
    heartbeatState = message.data[0];
    heartbeatSeenAt = millis();
  } else if (message.identifier == STATUS_ID && message.data_length_code == 8) {
    neutral = message.data[0] == 0x20;
    safetySeenAt = millis();
  } else if (message.identifier == SPEED_ID && message.data_length_code == 8) {
    const uint16_t raw = (uint16_t(message.data[6]) << 8) | message.data[7];
    speedKph = raw == 0xFFFF ? NAN : raw / 100.0f;
    safetySeenAt = millis();
  }
}

bool safetyFresh() {
  return safetySeenAt != 0 && millis() - safetySeenAt < 1500;
}

bool stationaryAndNeutral() {
  return safetyFresh() && neutral && isfinite(speedKph) && fabsf(speedKph) < 0.05f;
}

bool sendFrame(uint32_t id, const uint8_t* data, uint8_t length) {
  twai_message_t message = {};
  message.identifier = id;
  message.data_length_code = length;
  memcpy(message.data, data, length);
  return twai_transmit(&message, pdMS_TO_TICKS(100)) == ESP_OK;
}

bool waitForSdo(uint16_t index, uint8_t sub, twai_message_t& response,
                uint32_t timeoutMs) {
  const uint32_t deadline = millis() + timeoutMs;
  while (int32_t(deadline - millis()) > 0) {
    twai_message_t message;
    if (twai_receive(&message, pdMS_TO_TICKS(2)) != ESP_OK) continue;
    consumeVehicleFrame(message);
    if (message.identifier == SDO_RESPONSE_ID &&
        message.data_length_code == 8 &&
        message.data[1] == uint8_t(index & 0xFF) &&
        message.data[2] == uint8_t(index >> 8) &&
        message.data[3] == sub) {
      response = message;
      return true;
    }
  }
  return false;
}

SdoResult exchangeSdo(const uint8_t request[8], uint16_t index, uint8_t sub) {
  SdoResult result;
  for (int attempt = 1; attempt <= 3; ++attempt) {
    if (!sendFrame(SDO_REQUEST_ID, request, 8)) continue;
    twai_message_t response = {};
    if (!waitForSdo(index, sub, response, 75)) {
      delay(10);
      continue;
    }

    result.responseCommand = response.data[0];
    result.value = uint32_t(response.data[4]) |
                   (uint32_t(response.data[5]) << 8) |
                   (uint32_t(response.data[6]) << 16) |
                   (uint32_t(response.data[7]) << 24);
    if (response.data[0] == 0x80) {
      result.aborted = true;
      result.abortCode = result.value;
      return result;
    }
    result.ok = true;
    return result;
  }
  return result;
}

SdoResult readSdo(uint16_t index, uint8_t sub) {
  uint8_t request[8] = {0x40, uint8_t(index & 0xFF), uint8_t(index >> 8),
                        sub, 0, 0, 0, 0};
  SdoResult result = exchangeSdo(request, index, sub);
  if (result.ok) {
    // Require an expedited upload response (0x4F/0x4B/0x47/0x43).
    result.ok = !result.aborted &&
                (result.responseCommand & 0xE0) == 0x40 &&
                (result.responseCommand & 0x02) != 0;
  }
  return result;
}

SdoResult writeSdo(uint16_t index, uint8_t sub, uint32_t value) {
  // Twizy-Cfg/OVMS use expedited download without size indication (0x22).
  uint8_t request[8] = {0x22, uint8_t(index & 0xFF), uint8_t(index >> 8),
                        sub, uint8_t(value), uint8_t(value >> 8),
                        uint8_t(value >> 16), uint8_t(value >> 24)};
  SdoResult result = exchangeSdo(request, index, sub);
  result.ok = result.ok && !result.aborted && result.responseCommand == 0x60;
  return result;
}

void printSdoError(const char* operation, uint16_t index, uint8_t sub,
                   const SdoResult& result) {
  Serial.printf("%s 0x%04X.%02X failed", operation, index, sub);
  if (result.aborted) Serial.printf(" abort=0x%08lX", result.abortCode);
  else Serial.print(" timeout/transport");
  Serial.println();
}

bool nmtStartIfStopped() {
  if (heartbeatState != 0x04) return true;
  const uint8_t frame[2] = {0x01, 0x01};
  Serial.println("SEVCON heartbeat=STOPPED; sending targeted NMT Start");
  if (!sendFrame(NMT_ID, frame, 2)) return false;
  delay(100);
  return true;
}

bool loginLevel4() {
  SdoResult type = readSdo(0x1018, 0x02);
  if (!type.ok || type.value != 0x0712302D) {
    printSdoError("identify", 0x1018, 0x02, type);
    Serial.printf("Expected Twizy 80 PID 0x0712302D, received 0x%08lX\n",
                  type.value);
    return false;
  }

  SdoResult level = readSdo(0x5000, 0x01);
  if (!level.ok) return false;
  if (level.value == 4) return true;

  SdoResult r1 = writeSdo(0x5000, 0x03, 0);
  SdoResult r2 = writeSdo(0x5000, 0x02, 0x4BDF);
  SdoResult verify = readSdo(0x5000, 0x01);
  if (!r1.ok || !r2.ok || !verify.ok || verify.value != 4) {
    Serial.println("SEVCON level-4 login failed");
    return false;
  }
  return true;
}

void logout() {
  writeSdo(0x5000, 0x03, 0);
  writeSdo(0x5000, 0x02, 0);
}

bool setConfigMode(bool preOperational) {
  SdoResult write =
      writeSdo(0x2800, 0x00, preOperational ? 1 : 0);
  if (!write.ok) {
    printSdoError(preOperational ? "pre-op" : "operational",
                  0x2800, 0x00, write);
    return false;
  }
  delay(10);
  SdoResult state = readSdo(0x5110, 0x00);
  const uint32_t expected = preOperational ? 127 : 5;
  if (!state.ok || state.value != expected) {
    Serial.printf("State verification failed: expected %lu, got %lu\n",
                  expected, state.value);
    return false;
  }
  return true;
}

void rollback() {
  Serial.println("ROLLBACK: restoring captured values in reverse order");
  for (int i = int(queueSize) - 1; i >= 0; --i) {
    QueuedWrite& item = queueItems[i];
    if (!item.written || !item.snapshotValid) continue;
    SdoResult restored = writeSdo(item.index, item.sub, item.original);
    Serial.printf("restore 0x%04X.%02X = 0x%08lX : %s\n",
                  item.index, item.sub, item.original,
                  restored.ok ? "OK" : "FAILED");
  }
}

bool applyQueue() {
  if (!deadlineActive(writeArmUntil)) {
    Serial.println("DENIED: tuner is not armed");
    return false;
  }
  writeArmUntil = 0;  // one transaction per arm
  if (queueSize == 0) {
    Serial.println("DENIED: queue is empty");
    return false;
  }
  if (!stationaryAndNeutral()) {
    Serial.println("DENIED: need fresh CAN evidence of 0.00 km/h and Neutral");
    return false;
  }

  if (!nmtStartIfStopped() || !loginLevel4()) return false;

  Serial.println("Snapshotting all queued registers...");
  for (size_t i = 0; i < queueSize; ++i) {
    SdoResult old = readSdo(queueItems[i].index, queueItems[i].sub);
    if (!old.ok) {
      printSdoError("snapshot", queueItems[i].index, queueItems[i].sub, old);
      logout();
      return false;
    }
    queueItems[i].original = old.value;
    queueItems[i].snapshotValid = true;
    queueItems[i].written = false;
  }

  bool enteredPreOp = setConfigMode(true);
  if (!enteredPreOp) {
    logout();
    return false;
  }

  bool ok = true;
  for (size_t i = 0; i < queueSize; ++i) {
    if (!stationaryAndNeutral()) {
      Serial.println("ABORT: vehicle safety state changed");
      ok = false;
      break;
    }
    QueuedWrite& item = queueItems[i];
    SdoResult written = writeSdo(item.index, item.sub, item.value);
    if (!written.ok) {
      printSdoError("write", item.index, item.sub, written);
      ok = false;
      break;
    }
    item.written = true;

    SdoResult verify = readSdo(item.index, item.sub);
    if (!verify.ok || verify.value != item.value) {
      Serial.printf("VERIFY failed 0x%04X.%02X wanted=0x%08lX got=0x%08lX\n",
                    item.index, item.sub, item.value, verify.value);
      ok = false;
      break;
    }
    Serial.printf("verified 0x%04X.%02X = 0x%08lX\n",
                  item.index, item.sub, item.value);
  }

  if (!ok) rollback();

  const bool opRestored = setConfigMode(false);
  logout();
  Serial.printf("Transaction %s; operational restore %s\n",
                ok ? "COMMITTED" : "ROLLED BACK",
                opRestored ? "OK" : "FAILED");
  return ok && opRestored;
}

void showStatus() {
  Serial.printf("heartbeat=0x%02X age=%lums speed=%.2f neutral=%s safety_age=%lums\n",
                heartbeatState,
                heartbeatSeenAt ? millis() - heartbeatSeenAt : 0,
                speedKph, neutral ? "yes" : "no",
                safetySeenAt ? millis() - safetySeenAt : 0);
  Serial.printf("physical_arm=%s write_arm=%s queued=%u\n",
                deadlineActive(physicalArmUntil) ? "open" : "closed",
                deadlineActive(writeArmUntil) ? "armed" : "safe",
                unsigned(queueSize));
}

void showQueue() {
  for (size_t i = 0; i < queueSize; ++i) {
    Serial.printf("%02u: 0x%04X.%02X = 0x%08lX\n", unsigned(i),
                  queueItems[i].index, queueItems[i].sub, queueItems[i].value);
  }
}

void identifyController() {
  const uint8_t subs[] = {1, 2, 3, 4};
  const char* labels[] = {"vendor", "product", "revision", "serial"};
  for (size_t i = 0; i < 4; ++i) {
    SdoResult result = readSdo(0x1018, subs[i]);
    if (result.ok) {
      Serial.printf("%s 0x1018.%02X = 0x%08lX\\n",
                    labels[i], subs[i], result.value);
    } else {
      printSdoError("identify", 0x1018, subs[i], result);
    }
  }
}

void showFaultHistory() {
  SdoResult count = readSdo(0x1003, 0x00);
  if (!count.ok) {
    printSdoError("fault-count", 0x1003, 0x00, count);
    return;
  }
  const uint8_t entries = min(uint32_t(32), count.value);
  Serial.printf("fault history entries=%u\\n", entries);
  for (uint8_t sub = 1; sub <= entries; ++sub) {
    SdoResult fault = readSdo(0x1003, sub);
    if (!fault.ok) {
      printSdoError("fault", 0x1003, sub, fault);
      break;
    }
    Serial.printf("fault[%u] = 0x%08lX\\n", sub, fault.value);
  }
}

void runDiagnosis() {
  showStatus();
  identifyController();
  showFaultHistory();
}

void help() {
  Serial.println("Commands:");
  Serial.println("  status | identify | faults | diagnose");
  Serial.println("  read <index_hex> <sub_hex>");
  Serial.println("  queue <index_hex> <sub_hex> <value>");
  Serial.println("  show | inspect | clear");
  Serial.println("  arm V12        (after holding Button A for 3 seconds)");
  Serial.println("  inspect        (read-only snapshot/diff of queued registers)");
  Serial.println("  apply          (snapshot -> login -> pre-op -> write/readback -> op)");
  Serial.println("No TFT, no automatic profile writes, no v14 PMAP formulas.");
}

void inspectQueue() {
  if (queueSize == 0) {
    Serial.println("queue is empty");
    return;
  }
  if (!stationaryAndNeutral()) {
    Serial.println("DENIED: need fresh CAN evidence of 0.00 km/h and Neutral");
    return;
  }
  if (!nmtStartIfStopped() || !loginLevel4()) return;
  Serial.println("READ-ONLY INSPECTION: current -> requested");
  for (size_t i = 0; i < queueSize; ++i) {
    SdoResult current = readSdo(queueItems[i].index, queueItems[i].sub);
    if (current.ok) {
      Serial.printf("0x%04X.%02X : 0x%08lX -> 0x%08lX %s\\n",
                    queueItems[i].index, queueItems[i].sub, current.value,
                    queueItems[i].value,
                    current.value == queueItems[i].value ? "(unchanged)" : "");
    } else {
      printSdoError("inspect", queueItems[i].index, queueItems[i].sub, current);
    }
  }
  logout();
}

void handleLine(char* line) {
  while (*line == ' ') ++line;
  if (!strcmp(line, "help")) return help();
  if (!strcmp(line, "status")) return showStatus();
  if (!strcmp(line, "identify")) return identifyController();
  if (!strcmp(line, "faults")) return showFaultHistory();
  if (!strcmp(line, "diagnose")) return runDiagnosis();
  if (!strcmp(line, "show")) return showQueue();
  if (!strcmp(line, "inspect")) return inspectQueue();
  if (!strcmp(line, "clear")) {
    queueSize = 0;
    Serial.println("queue cleared");
    return;
  }
  if (!strcmp(line, "arm V12")) {
    if (!deadlineActive(physicalArmUntil)) {
      Serial.println("DENIED: hold Button A for 3 seconds first");
      return;
    }
    if (!stationaryAndNeutral()) {
      Serial.println("DENIED: vehicle must be stationary in Neutral");
      return;
    }
    physicalArmUntil = 0;
    writeArmUntil = millis() + 60000;
    Serial.println("ARMED for one transaction / 60 seconds");
    return;
  }
  if (!strcmp(line, "apply")) {
    applyQueue();
    return;
  }

  unsigned index = 0, sub = 0;
  unsigned long value = 0;
  if (sscanf(line, "read %x %x", &index, &sub) == 2) {
    SdoResult result = readSdo(uint16_t(index), uint8_t(sub));
    if (result.ok) Serial.printf("0x%04X.%02X = 0x%08lX (%lu)\n",
                                 index, sub, result.value, result.value);
    else printSdoError("read", uint16_t(index), uint8_t(sub), result);
    return;
  }
  char valueToken[32] = {};
  if (sscanf(line, "queue %x %x %31s", &index, &sub, valueToken) == 3) {
    char* end = nullptr;
    value = strtoul(valueToken, &end, 0);
    if (!end || *end != 0) {
      Serial.println("invalid value; use decimal or 0x-prefixed hexadecimal");
      return;
    }
    if (index > 0xFFFF || sub > 0xFF) {
      Serial.println("invalid CANopen index/subindex");
      return;
    }
    if (queueSize >= MAX_QUEUE) {
      Serial.println("queue full");
      return;
    }
    QueuedWrite& item = queueItems[queueSize++];
    item.index = uint16_t(index);
    item.sub = uint8_t(sub);
    item.value = uint32_t(value);
    item.original = 0;
    item.snapshotValid = false;
    item.written = false;
    Serial.printf("queued 0x%04X.%02X = 0x%08lX\n", index, sub, value);
    return;
  }
  Serial.println("Unknown command; type help");
}

void pollSerial() {
  static char line[160];
  static size_t length = 0;
  while (Serial.available()) {
    const char c = char(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      line[length] = 0;
      if (length) handleLine(line);
      length = 0;
    } else if (length + 1 < sizeof(line)) {
      line[length++] = c;
    }
  }
}

void pollCan() {
  twai_message_t message;
  while (twai_receive(&message, 0) == ESP_OK) consumeVehicleFrame(message);
}

void pollButton() {
  const bool down = digitalRead(BUTTON_A_PIN) == LOW;
  if (down && !buttonWasDown) {
    buttonDownAt = millis();
    buttonHoldAnnounced = false;
    Serial.println("Button A pressed...");
  }
  if (down && !buttonHoldAnnounced && millis() - buttonDownAt >= 3000) {
    physicalArmUntil = millis() + 30000;
    buttonHoldAnnounced = true;
    Serial.println("Physical arm window OPEN for 30 seconds; enter: arm V12");
  }
  if (!down) buttonHoldAnnounced = false;
  buttonWasDown = down;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(400);
  // GPIO37 is input-only; M5StickC Plus2 provides the external button pull-up.
  pinMode(BUTTON_A_PIN, INPUT);

  const twai_general_config_t general =
      TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_PIN, CAN_RX_PIN, TWAI_MODE_NORMAL);
  const twai_timing_config_t timing = TWAI_TIMING_CONFIG_500KBITS();
  const twai_filter_config_t filter = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&general, &timing, &filter) != ESP_OK ||
      twai_start() != ESP_OK) {
    Serial.println("FATAL: TWAI init failed");
    while (true) delay(1000);
  }

  Serial.println("Twizy tuner v12 headless");
  Serial.println("M5StickC Plus2 + M5 Unit CAN, GPIO32/33, 500 kbit/s");
  help();
}

void loop() {
  pollCan();
  pollButton();
  pollSerial();
  delay(2);
}
