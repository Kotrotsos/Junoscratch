export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
}

export type MidiPermissionStatus = 'idle' | 'granted' | 'denied' | 'unsupported';

export type IncomingMidiEvent =
  | {
      type: 'noteon';
      note: number;
      velocity: number; // 1..127
      channel: number; // 1..16
      deviceId: string;
      deviceName: string;
    }
  | {
      type: 'noteoff';
      note: number;
      velocity: number;
      channel: number; // 1..16
      deviceId: string;
      deviceName: string;
    }
  | {
      type: 'cc';
      cc: number; // 0..127
      value: number; // 0..127
      channel: number; // 1..16
      deviceId: string;
      deviceName: string;
    }
  | {
      type: 'pitchbend';
      norm: number; // -1..+1
      channel: number; // 1..16
      deviceId: string;
      deviceName: string;
    };

export interface MidiEngineStatus {
  supported: boolean;
  permission: MidiPermissionStatus;
  inputs: MidiDeviceInfo[];
  errorMessage: string | null;
}

type MidiEventListener = (event: IncomingMidiEvent) => void;
type MidiStatusListener = (status: MidiEngineStatus) => void;

class HardwareMidiEngine {
  private access: MIDIAccess | null = null;
  private permission: MidiPermissionStatus = 'idle';
  private errorMessage: string | null = null;
  private eventListeners = new Set<MidiEventListener>();
  private statusListeners = new Set<MidiStatusListener>();
  private boundInputs = new Map<string, (e: MIDIMessageEvent) => void>();

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  getStatus(): MidiEngineStatus {
    const inputs: MidiDeviceInfo[] = [];
    if (this.access) {
      this.access.inputs.forEach((input) => {
        if (input.state === 'connected') {
          inputs.push({
            id: input.id,
            name: input.name || 'MIDI Hardware Input',
            manufacturer: input.manufacturer || '',
            state: input.state,
          });
        }
      });
    }
    return {
      supported: this.isSupported(),
      permission: this.isSupported() ? this.permission : 'unsupported',
      inputs,
      errorMessage: this.errorMessage,
    };
  }

  async init(): Promise<MidiEngineStatus> {
    if (!this.isSupported()) {
      this.permission = 'unsupported';
      this.notifyStatus();
      return this.getStatus();
    }

    if (this.access) {
      this.attachInputs();
      this.notifyStatus();
      return this.getStatus();
    }

    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.access = access;
      this.permission = 'granted';
      this.errorMessage = null;

      access.onstatechange = () => {
        this.attachInputs();
        this.notifyStatus();
      };

      this.attachInputs();
      this.notifyStatus();
    } catch (err) {
      console.warn('Web MIDI access unavailable:', err);
      this.permission = 'denied';
      this.errorMessage =
        'Browser MIDI access was blocked or unavailable. You can still test MIDI Learn using the built-in Test CC transmitter.';
      this.notifyStatus();
    }

    return this.getStatus();
  }

  private attachInputs(): void {
    if (!this.access) return;

    const seenIds = new Set<string>();
    this.access.inputs.forEach((input) => {
      seenIds.add(input.id);
      if (!this.boundInputs.has(input.id)) {
        const handler = (ev: MIDIMessageEvent) => {
          this.handleRawMidiMessage(input.id, input.name || 'MIDI Input', ev.data);
        };
        input.addEventListener('midimessage', handler);
        this.boundInputs.set(input.id, handler);
      }
    });

    // Clean up unplugged inputs
    for (const [id] of this.boundInputs.entries()) {
      if (!seenIds.has(id)) {
        this.boundInputs.delete(id);
      }
    }
  }

  private handleRawMidiMessage(
    deviceId: string,
    deviceName: string,
    data: Uint8Array | null
  ): void {
    if (!data || data.length < 2) return;

    const statusByte = data[0];
    // Ignore MIDI clock / active sensing system real-time bytes >= 0xF0
    if (statusByte >= 0xf0) return;

    const command = statusByte & 0xf0;
    const channel = (statusByte & 0x0f) + 1; // 1..16
    const data1 = data[1] & 0x7f;
    const data2 = data.length > 2 ? data[2] & 0x7f : 0;

    if (command === 0x90) {
      if (data2 > 0) {
        this.emitEvent({
          type: 'noteon',
          note: data1,
          velocity: data2,
          channel,
          deviceId,
          deviceName,
        });
      } else {
        this.emitEvent({
          type: 'noteoff',
          note: data1,
          velocity: 0,
          channel,
          deviceId,
          deviceName,
        });
      }
    } else if (command === 0x80) {
      this.emitEvent({
        type: 'noteoff',
        note: data1,
        velocity: data2,
        channel,
        deviceId,
        deviceName,
      });
    } else if (command === 0xb0) {
      this.emitEvent({
        type: 'cc',
        cc: data1,
        value: data2,
        channel,
        deviceId,
        deviceName,
      });
    } else if (command === 0xe0) {
      const bend14 = (data2 << 7) | data1; // 0..16383, center 8192
      const norm = Math.max(-1, Math.min(1, (bend14 - 8192) / 8192));
      this.emitEvent({
        type: 'pitchbend',
        norm,
        channel,
        deviceId,
        deviceName,
      });
    }
  }

  /**
   * Injects a real CC packet into the MIDI event stream (for built-in MIDI Learn verification)
   */
  injectTestCC(cc: number, value: number, channel = 1): void {
    const safeCc = Math.max(0, Math.min(127, Math.round(cc)));
    const safeVal = Math.max(0, Math.min(127, Math.round(value)));
    const safeCh = Math.max(1, Math.min(16, Math.round(channel)));
    this.emitEvent({
      type: 'cc',
      cc: safeCc,
      value: safeVal,
      channel: safeCh,
      deviceId: 'virtual-test-port',
      deviceName: 'Virtual MIDI Bus',
    });
  }

  subscribeEvents(listener: MidiEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeStatus(listener: MidiStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private emitEvent(event: IncomingMidiEvent): void {
    this.eventListeners.forEach((fn) => fn(event));
  }

  private notifyStatus(): void {
    const snapshot = this.getStatus();
    this.statusListeners.forEach((fn) => fn(snapshot));
  }
}

export const midiEngine = new HardwareMidiEngine();
