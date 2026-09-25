// ==============================================================================
// AirDnD Web Serial Bridge for ESP32-C6 Hardware-in-the-Loop Node
// Communicates with /dev/cu.usbmodem101 over USB CDC serial at 115200 baud
// ==============================================================================

export class SerialBridge {
  constructor(onStatusChange, onTelemetry, onJamToggle) {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.onStatusChange = onStatusChange || (() => {});
    this.onTelemetry = onTelemetry || (() => {});
    this.onJamToggle = onJamToggle || (() => {});
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.incomingBuffer = '';
  }

  isSupported() {
    return 'serial' in navigator;
  }

  async connect() {
    if (!this.isSupported()) {
      alert('Web Serial API is not supported in this browser. Please use Google Chrome, Edge, Brave, or Arc.');
      return false;
    }

    try {
      // Request serial port from user
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });

      this.isConnected = true;
      this.onStatusChange(true);

      // Start continuous background read loop
      this.readLoop();
      return true;
    } catch (err) {
      console.warn('Web Serial connection cancelled or failed:', err);
      this.isConnected = false;
      this.onStatusChange(false);
      return false;
    }
  }

  async readLoop() {
    while (this.port && this.port.readable && this.isConnected) {
      try {
        this.reader = this.port.readable.getReader();
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            this.incomingBuffer += this.decoder.decode(value);
            const lines = this.incomingBuffer.split('\n');
            this.incomingBuffer = lines.pop(); // keep partial line
            for (const line of lines) {
              this.processLine(line.trim());
            }
          }
        }
      } catch (err) {
        console.warn('Serial read error:', err);
        break;
      } finally {
        if (this.reader) {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    }
    this.isConnected = false;
    this.onStatusChange(false);
  }

  processLine(line) {
    if (!line) return;

    // 1. Hardware Telemetry: "TELEMETRY:LOOP=2.4ms,HEAP=313KB,EPOCH=18,STATUS=ARMED"
    if (line.includes('LOOP=') && line.includes('HEAP=')) {
      const loopMatch = line.match(/LOOP=([\d.]+)ms/);
      const heapMatch = line.match(/HEAP=(\d+)KB/);
      this.onTelemetry({
        loopMs: loopMatch ? loopMatch[1] : '2.4',
        heapKb: heapMatch ? heapMatch[1] : '313',
      });
    }

    // 2. Physical Button Trigger on ESP32 (GPIO 9 BOOT button)
    if (line.includes('EW_JAM_TRIGGER:TOGGLE')) {
      console.log('[ESP32-C6] Physical EW Jamming toggle button pressed!');
      this.onJamToggle();
    }

    // 3. Bid Acknowledgment: "BID_ACK:T014,SCORE=0.920,TIME_US=142"
    if (line.startsWith('BID_ACK:')) {
      console.log('[ESP32-C6] Target Bid Acknowledged:', line);
    }
  }

  // Send compact target frame (<= 32 bytes) to physical ESP32
  async sendAuctionFrame(threatId, defenderId, bidScore) {
    if (!this.isConnected || !this.port || !this.port.writable) return;

    try {
      this.writer = this.port.writable.getWriter();
      // Compact frame format: "BID:T012,D01,0.85\n" (20 bytes)
      const payload = `BID:${threatId},${defenderId},${bidScore.toFixed(2)}\n`;
      await this.writer.write(this.encoder.encode(payload));
    } catch (err) {
      console.warn('Serial write error:', err);
    } finally {
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }
    }
  }

  async disconnect() {
    this.isConnected = false;
    if (this.reader) {
      await this.reader.cancel();
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    this.onStatusChange(false);
  }
}
