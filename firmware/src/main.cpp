#include <Arduino.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <driver/twai.h>

#define DEVICE_NAME "TwizyPB"
#define CAN_TX_PIN GPIO_NUM_32
#define CAN_RX_PIN GPIO_NUM_33

// Nordic UART Service; kept compatible with the migrated Android app.
#define NUS_SERVICE "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_CHAR "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX_CHAR "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// Verified in the Drive CANBUS Objektverzeichnis.
static constexpr uint32_t ID_BMS_1 = 0x155;
static constexpr uint32_t ID_MOTOR = 0x196;
static constexpr uint32_t ID_CELL_TEMP = 0x554;
static constexpr uint32_t ID_PACK_VOLTAGE = 0x55F;
static constexpr uint32_t ID_SPEED = 0x599;
static constexpr uint32_t ID_CONTROLLER = 0x59E;

struct Telemetry {
  float voltage = NAN;
  float current = NAN;       // positive = discharge, negative = charge
  float power = NAN;
  float speed = NAN;
  float motorTemp = NAN;
  float controllerTemp = NAN;
  float batteryTemp = NAN;
  float soc = NAN;
  bool bmsDataValid = false;
  uint32_t lastFrameMs = 0;
  uint32_t frames = 0;
} telemetry;

static NimBLECharacteristic* txCharacteristic = nullptr;
static bool bleConnected = false;

static uint16_t be16(const uint8_t* data) {
  return (uint16_t(data[0]) << 8) | data[1];
}

static bool plausiblePackVoltage(float value) {
  return value >= 40.0f && value <= 70.0f;
}

static void decodeFrame(const twai_message_t& message) {
  if (message.flags & TWAI_MSG_FLAG_EXTD) return;
  const uint8_t* d = message.data;
  const uint8_t len = message.data_length_code;
  telemetry.lastFrameMs = millis();
  telemetry.frames++;

  switch (message.identifier) {
    case ID_BMS_1:
      if (len == 8) {
        // Spreadsheet bytes are 1-based: current=B2+B3, phase=B4, SOC=B5+B6.
        const uint16_t rawCurrent = be16(&d[1]) & 0x0FFF;
        telemetry.current = (2000.0f - rawCurrent) / 4.0f;
        telemetry.bmsDataValid = d[3] == 0x54;
        telemetry.soc = be16(&d[4]) / 400.0f;
      }
      break;

    case ID_MOTOR:
      if (len == 8) telemetry.motorTemp = int(d[5]) - 40.0f;
      break;

    case ID_CELL_TEMP:
      if (len == 8) {
        float sum = 0.0f;
        for (int i = 0; i < 7; ++i) sum += int(d[i]) - 40.0f;
        telemetry.batteryTemp = sum / 7.0f;
      }
      break;

    case ID_PACK_VOLTAGE:
      if (len == 8) {
        // Two packed 12-bit total-voltage readings occupy bytes 6..8.
        const float v1 = ((uint16_t(d[5]) << 4) | (d[6] >> 4)) / 10.0f;
        const float v2 = ((uint16_t(d[6] & 0x0F) << 8) | d[7]) / 10.0f;
        if (plausiblePackVoltage(v1) && plausiblePackVoltage(v2)) {
          telemetry.voltage = (v1 + v2) * 0.5f;
        } else if (plausiblePackVoltage(v1)) {
          telemetry.voltage = v1;
        } else if (plausiblePackVoltage(v2)) {
          telemetry.voltage = v2;
        }
      }
      break;

    case ID_SPEED:
      if (len == 8) {
        const uint16_t raw = be16(&d[6]);
        if (raw != 0xFFFF) telemetry.speed = raw / 100.0f;
      }
      break;

    case ID_CONTROLLER:
      if (len == 8) telemetry.controllerTemp = int(d[5]) - 40.0f;
      break;
  }

  if (isfinite(telemetry.voltage) && isfinite(telemetry.current)) {
    telemetry.power = telemetry.voltage * telemetry.current;
  }
}

static bool startCanListenOnly() {
  const twai_general_config_t general =
      TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_PIN, CAN_RX_PIN, TWAI_MODE_LISTEN_ONLY);
  const twai_timing_config_t timing = TWAI_TIMING_CONFIG_500KBITS();
  const twai_filter_config_t filter = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&general, &timing, &filter) != ESP_OK) return false;
  return twai_start() == ESP_OK;
}

class ServerCallbacks final : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*) override { bleConnected = true; }
  void onDisconnect(NimBLEServer*) override {
    bleConnected = false;
    NimBLEDevice::startAdvertising();
  }
};

class RxCallbacks final : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic) override {
    // Commands are deliberately ignored in the safe baseline.
    Serial.printf("Ignored BLE command (%u bytes): transmit disabled\n",
                  unsigned(characteristic->getValue().size()));
  }
};

static void startBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService* service = server->createService(NUS_SERVICE);
  txCharacteristic =
      service->createCharacteristic(NUS_TX_CHAR, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* rx =
      service->createCharacteristic(NUS_RX_CHAR,
                                    NIMBLE_PROPERTY::WRITE |
                                        NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(NUS_SERVICE);
  advertising->setScanResponse(true);
  advertising->start();
}

static void sendTelemetry() {
  StaticJsonDocument<256> document;
  if (isfinite(telemetry.voltage)) document["v"] = telemetry.voltage;
  if (isfinite(telemetry.current)) document["i"] = telemetry.current;
  if (isfinite(telemetry.power)) document["p"] = telemetry.power;
  if (isfinite(telemetry.soc)) document["soc"] = telemetry.soc;
  if (isfinite(telemetry.speed)) document["spd"] = telemetry.speed;
  if (isfinite(telemetry.motorTemp)) document["tmp"] = telemetry.motorTemp;
  document["valid"] = telemetry.bmsDataValid;
  document["frames"] = telemetry.frames;
  document["can_age_ms"] = millis() - telemetry.lastFrameMs;

  char json[256];
  const size_t length = serializeJson(document, json, sizeof(json));
  if (bleConnected && txCharacteristic && length > 0) {
    txCharacteristic->setValue(reinterpret_cast<uint8_t*>(json), length);
    txCharacteristic->notify();
  }

  Serial.printf(
      "%lu,%.2f,%.2f,%.1f,%.2f,%.1f,%.1f,%.1f,%s\n",
      telemetry.frames, telemetry.voltage, telemetry.current, telemetry.power,
      telemetry.soc, telemetry.speed, telemetry.motorTemp,
      telemetry.controllerTemp, telemetry.bmsDataValid ? "valid" : "invalid");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("TwizyPB safe telemetry");
  Serial.println("frames,voltage,current,power,soc,speed,motor_temp,controller_temp,bms");

  if (!startCanListenOnly()) {
    Serial.println("FATAL: CAN initialization failed");
    while (true) delay(1000);
  }

  Serial.println("CAN listen-only ready at 500 kbit/s; TX disabled");
  startBle();
}

void loop() {
  twai_message_t message;
  while (twai_receive(&message, 0) == ESP_OK) decodeFrame(message);

  static uint32_t lastSend = 0;
  if (millis() - lastSend >= 500) {
    lastSend = millis();
    sendTelemetry();
  }
  delay(2);
}
