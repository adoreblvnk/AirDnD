// ==============================================================================
// AirDnD Tactical Defense Node #1 — ESP32-C6 Embedded Auction Firmware
// Target: ESP32-C6 RISC-V @ 160MHz (FQBN: esp32:esp32:esp32c6)
// ==============================================================================

#include <Arduino.h>

// Onboard BOOT button on ESP32-C6 (active LOW)
#define BUTTON_PIN 9

// Node #1 Initial Station Coordinates (Singapore Littoral Killbox)
const float NODE_LAT = 1.1850;
const float NODE_LON = 103.7800;
const float NODE_SPEED = 180.0; // m/s (~650 km/h)

unsigned long lastTelemetryTime = 0;
unsigned long epoch = 0;
bool lastButtonState = HIGH;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  // Wait brief moment for USB CDC connection
  delay(1000);
  Serial.println("AIRDND_NODE_READY:CHIP=ESP32-C6,ARCH=RISC-V,FREQ=160MHZ");
}

void loop() {
  unsigned long now = millis();

  // 1. Check Physical EW Kill Switch (BOOT Button on GPIO 9)
  bool buttonState = digitalRead(BUTTON_PIN);
  if (buttonState == LOW && lastButtonState == HIGH) {
    // Button pressed: signal EW jamming toggle to host
    Serial.println("EW_JAM_TRIGGER:TOGGLE");
    delay(200); // Debounce
  }
  lastButtonState = buttonState;

  // 2. Stream Hardware Telemetry every 500ms
  if (now - lastTelemetryTime >= 500) {
    lastTelemetryTime = now;
    epoch++;
    
    uint32_t freeHeapKb = ESP.getFreeHeap() / 1024;
    // Calculate synthetic loop time in ms for current load
    float loopTimeMs = 2.4 + (float)(random(0, 10)) / 10.0;
    
    // Telemetry protocol frame
    Serial.printf("TELEMETRY:LOOP=%.1fms,HEAP=%uKB,EPOCH=%lu,STATUS=ARMED\n", 
                  loopTimeMs, freeHeapKb, epoch);
  }

  // 3. Handle Bidirectional Auction Requests from Host
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    if (line.startsWith("BID_REQ:")) {
      unsigned long startMicros = micros();
      
      // Expected frame format: "BID_REQ:T014,1.175,103.82,180"
      String payload = line.substring(8);
      int firstComma = payload.indexOf(',');
      int secondComma = payload.indexOf(',', firstComma + 1);
      int thirdComma = payload.indexOf(',', secondComma + 1);

      if (firstComma > 0 && secondComma > 0) {
        String threatId = payload.substring(0, firstComma);
        float threatLat = payload.substring(firstComma + 1, secondComma).toFloat();
        float threatLon = payload.substring(secondComma + 1, thirdComma > 0 ? thirdComma : payload.length()).toFloat();
        
        // Compute kinetic distance in meters (1 deg ~ 111,000m)
        float dLat = threatLat - NODE_LAT;
        float dLon = threatLon - NODE_LON;
        float distMeters = sqrt(dLat * dLat + dLon * dLon) * 111000.0;

        // Bidding score: inverse distance weighted by closing velocity
        float bidScore = (NODE_SPEED * 2.0) / (distMeters + 100.0);
        if (bidScore > 1.0) bidScore = 0.99;

        unsigned long computeUs = micros() - startMicros;

        // Acknowledge assignment back to host
        Serial.printf("BID_ACK:%s,SCORE=%.3f,TIME_US=%lu\n", 
                      threatId.c_str(), bidScore, computeUs);
      }
    }
  }
}
