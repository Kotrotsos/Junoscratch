export interface Point {
  x: number; // Normalized time 0 - 1
  y: number; // Normalized value 0 - 1
}

export interface EnvelopeData {
  points: Point[];
}

export type ToneMode = 'TEAROUT' | 'ROAR' | 'YOI' | 'SCREAM' | 'TUBE' | 'CLIP';
export type OscWaveType = 'SAW' | 'PULSE' | 'SUPER' | 'SYNC' | 'METAL' | 'TRI';
export type BuiltInSampleId = '909-drum' | 'sub-pulse' | 'reese-bass' | 'chord-stabs' | 'perc-loop';
export type RackTabId = 'voices' | 'growlLab' | 'phaseWarp' | 'spaceOtt' | 'fxChain';
export type CurvePlayMode = 'continuous' | 'oneshot';
export type SubThumpMode = 'FAST' | 'PUNCH' | '808';
export type OttFlavorMode = 'UPWARD' | 'SLAM' | 'CRISP';
export type PhaseScopeMode = 'goniometer' | 'lissajous';
export type KickTailType = '909' | 'SUB' | 'SAW' | 'ZAAG' | 'KRACH' | 'PIEP';
export type KickClipMode = 'GABBER' | 'GCLIP' | 'FOLD' | 'ZAAG' | 'BOILER';
export type KickLfoShape = 'SINE' | 'TRI' | 'SAW' | 'SQR';
export type KickLfoTarget = 'HUNT' | 'FM' | 'PITCH' | 'AMP';
export type SynthLfoTarget = 'GROWL' | 'VOWEL' | 'FILTER' | 'PITCH' | 'AMP';

export type FxDeviceType = 'saturator' | 'peq' | 'distort' | 'delay' | 'reverb';
export type FxSaturatorMode = 'TAPE' | 'TRIODE' | 'IRON';
export type FxDistortMode = 'GABBER' | 'HARD' | 'FUZZ' | 'FOLD' | 'RECT';
export type FxDelayMode = 'PING' | 'STEREO' | 'SLAP';
export type FxReverbMode = 'HALL' | 'BUNKER' | 'PLATE';

export interface FxSlotItem {
  id: string;
  type: FxDeviceType;
  enabled: boolean;
  mix: number; // 0 to 100 % Dry/Wet mix

  // Saturator
  satMode?: FxSaturatorMode;
  satDrive?: number; // 0 to 100 %
  satTone?: number; // -50 to +50 % Warmth / HF silk tilt
  satPunch?: number; // 0 to 100 % Analog low-end head-bump & low-mid clarity

  // Parametric EQ (3-Band: Low Shelf, Swept Parametric Bell w/ Q, High Shelf)
  eqLowHz?: number; // 40 to 400 Hz
  eqLowGainDb?: number; // -15 to +15 dB
  eqMidHz?: number; // 200 to 6500 Hz
  eqMidGainDb?: number; // -15 to +15 dB
  eqMidQ?: number; // 0.5 to 8.0
  eqHighHz?: number; // 2200 to 14000 Hz
  eqHighGainDb?: number; // -15 to +15 dB

  // Distort
  distMode?: FxDistortMode;
  distDrive?: number; // 0 to 100 %
  distToneHz?: number; // 700 to 16000 Hz post-filter
  distPunch?: number; // 0 to 100 % Pre-clip 909->Gabber resonant bark & post-box scoop
  distTightCut?: boolean; // Optional 92 Hz pre-HP sub cut (false = full 909 sub-pass)

  // Delay
  delayMode?: FxDelayMode;
  delayTimeMs?: number; // 30 to 950 ms
  delayFeedback?: number; // 0 to 88 %
  delayTone?: number; // 0 to 100 % dark-to-bright echo filter

  // Reverb
  revMode?: FxReverbMode;
  revSize?: number; // 0 to 100 % decay tail
  revDamp?: number; // 0 to 100 % tank brightness
  revPreDelayMs?: number; // 0 to 90 ms pre-delay
}

export interface SynthParams {
  // Edge Faders (dB)
  inGainDb: number;
  outGainDb: number;

  // Modular Hook-In Master FX Chain (Empty by default)
  fxChain?: FxSlotItem[];

  // JunoScratch Curve Transport
  curveMode: CurvePlayMode;
  curveSpeed: number; // 0.25x to 20.0x playhead speed through curves

  // Tab 1 Engine Switch: Synth & Master (false) vs Kick & Master (true)
  kickMode?: boolean;

  // Kick & Master — Panel 1: KICK BODY, FM RATIO & TOK (Cyan)
  kickPower?: boolean;
  kickTailType?: KickTailType; // '909' | 'SUB' | 'SAW' | 'ZAAG' | 'KRACH' | 'PIEP'
  kickPunch?: number; // 0 to 100 % Exponential pitch-drop depth & body impact
  kickFmRatio?: number; // 0.5 to 8.0 Harmonic FM ratio modulating sub/kick overtones
  kickTok?: number; // 0 to 100 % High-frequency click + woody transient knock
  kickTokBoost?: boolean; // Crisp 4.2 kHz metallic tok bite
  kickSweepMs?: number; // 10 to 180 ms Pitch-drop sweep time

  // Kick & Master — Panel 4: KICK ADSR ENVELOPE (Glowing Graph Handles)
  kickAttackMs?: number; // 0.5 to 65 ms Kick amp attack slope
  kickDecayMs?: number; // 60 to 1200 ms Kick body decay to sustain plateau
  kickSustain?: number; // 0 to 100 % Kick sausage/tail sustain level
  kickReleaseMs?: number; // 30 to 1200 ms Kick tail release time

  // Kick & Master — Panel 5: KICK LFO MODULATOR
  kickLfoPower?: boolean;
  kickLfoShape?: KickLfoShape; // 'SINE' | 'TRI' | 'SAW' | 'SQR'
  kickLfoTarget?: KickLfoTarget; // 'HUNT' | 'FM' | 'PITCH' | 'AMP'
  kickLfoRateHz?: number; // 0.2 to 24.0 Hz LFO speed
  kickLfoDepth?: number; // 0 to 100 % LFO modulation depth
  kickLfoSync?: boolean; // Retrigger LFO phase on every kick hit vs free-running

  // Kick & Master — Panel 2: KRACH & PRE-EQ ("Frequency Hunt" + Multi-Stage Destruction) (Amber)
  kickKrachPower?: boolean;
  kickClipMode?: KickClipMode; // 'GABBER' | 'GCLIP' | 'FOLD' | 'ZAAG' | 'BOILER'
  kickDrive?: number; // 0 to 100 % Multi-stage clipper & wavefolder drive
  kickEqFreqHz?: number; // 240 to 4200 Hz Pre-distortion resonant peak frequency
  kickEqGain?: number; // 0 to 100 % Pre-distortion boost (+0..+14 dB) & Q focus
  kickEqSweep?: boolean; // Sweep Pre-EQ frequency along JunoScratch curve

  // Kick & Master — Panel 3: RUMBLE & STOMP (Industrial Techno Rumble + Sidechain + BPM Loop) (Blue)
  kickRumblePower?: boolean;
  kickLoop?: boolean; // 4/4 BPM Stomper Auto-Repeat vs 1-Shot hit
  kickBpm?: number; // 115 to 240 BPM Stomp & Rumble sync tempo
  kickRumbleAmt?: number; // 0 to 100 % Dark cavern industrial rumble mix & grit
  kickDuck?: number; // 0 to 100 % Kick-triggered sidechain pump depth
  kickRumbleLpHz?: number; // 110 to 1200 Hz Dark cavern low-pass filter
  kickRumbleGroove?: boolean; // Straight 1/16 vs Dotted 3/32 warehouse bounce

  // Tab 1 — Module 0: OSC SYNTHESIZER PANEL (Cyan)
  oscPower: boolean;
  oscWave: OscWaveType;
  oscLevel: number; // 0 to 100 %
  oscDetune: number; // 0 to 100 % stereo unison / dual-osc detune
  oscShape: number; // 0 to 100 % PWM width / Sync sweep / Wave contour
  oscNoise: number; // 0 to 100 % Analog pink/white erosion noise into FX chain
  oscRingMod: boolean; // Audio-rate OSC1 x OSC2 Ring Modulation
  oscInterval: number; // -12, 0, 7, 12 semitones on OSC 2

  // Tab 1 — Module 1: GRAIN (Blue)
  grainPower: boolean;
  grainReverse: boolean;
  grainFreeze: boolean;
  baseSpeed: number; // 0.2x to 2.5x
  grainSizeMs: number; // 15 to 450 ms
  grainOverlapMs: number; // 5 to 200 ms

  // Tab 1 — Module 2: FM GROWL CENTRAL MACRO ENGINE (Amber)
  fmPower: boolean;
  fmSubOctave: boolean; // -1 Oct pure sub sine anchor
  fmUnison: boolean; // Wide detuned neuro saw layer
  fmGrowl: number; // 0 to 100 % Central Growl Macro
  fmRatio: number; // 0.5 to 8.0 harmonic ratio
  fmWobbleRate: number; // 0 to 16 Hz Growl LFO speed (0 Hz = steady manual/curve growl)
  fmInflect: number; // 0 to 100 % Coupled vocal-cord pitch inflection bend
  fmMetalAmt?: number; // 0 to 100 % Metallic Riddim FM sidebands & high-Bessel bite (0% = warm organic Growl)

  // Tab 2 — Growl FX Lab 1: WAH PEDAL (Cyan)
  wahPower: boolean;
  wahAmount: number; // 0 to 100 % Wah peak gain / intensity
  wahBaseHz: number; // 160 to 900 Hz base resonant sweep floor
  wahResonance: number; // 0 to 100 % Wah Q factor (2.0 to 11.5)
  wahMorph: number; // 0 to 100 % Sweep span across Growl LFO + Pitch Env

  // Tab 2 — Growl FX Lab 2: VOWEL TRACT & NOTCH (Amber)
  formantPower: boolean;
  fmVowel: number; // 0 to 100 % Vocal formant morph (U -> O -> A -> E -> I)
  formantTalk: number; // 0 to 100 % Formant peak dB boost & movement
  notchEnable: boolean; // Counter-swept surgical neuro notch
  notchDepth: number; // 0 to 100 % Counter-notch Q & sweep depth

  // Tab 2 — Growl FX Lab 3: THROAT COMB (Violet)
  combPower: boolean;
  combKeyTrack: boolean; // Track comb delay to played note harmonic vs fixed ms
  fmMetal: number; // 0 to 100 % Metallic comb wet resonance mix
  combHarmonic: number; // 1.0 to 8.0 harmonic multiple of carrier
  combFeedbackAmt: number; // 0 to 100 % Feedback loop regeneration (up to 0.78)
  combDamp: number; // 0 to 100 % Feedback loop HF brightness (1.4 kHz to 11 kHz)

  // Tab 2 — Growl FX Lab 4: BITCRUSH (Amber)
  crushPower: boolean;
  fmCrush: number; // 0 to 100 % Mid/high (> Xover) staircase bitcrusher

  // Tab 2 — Growl FX Lab 5: XOVER SUB (Cyan)
  xoverFreqHz: number; // 60 to 240 Hz 4th-Order Linkwitz-Riley split (default 115 Hz)
  subPunch: number; // 0 to 100 % Clean < Xover low-band chest weight (50% = 0 dB unity)
  subSolo: boolean; // Solo < Xover sub band (mutes > Xover mangler for phase check)

  // Tab 3 — Phase & Warp 1: ALL-PASS PHASE DISPERSER (Cyan)
  disperserPower?: boolean;
  disperserAmount?: number; // 0 to 100 % 16-stage all-pass dispersion mix
  disperserFreqHz?: number; // 80 to 1200 Hz laser pinch center frequency
  disperserPinch?: number; // 0 to 100 % all-pass Q focus
  disperserSweep?: number; // 0 to 100 % curve & LFO sweep span

  // Tab 3 — Phase & Warp 2: BODE FREQUENCY SHIFTER (Amber)
  freqShiftPower?: boolean;
  freqShiftHz?: number; // -400 to +400 Hz linear SSB shift (> Xover)
  freqShiftMix?: number; // 0 to 100 % wet mix
  freqShiftFeedback?: number; // 0 to 100 % barberpole regeneration
  freqShiftBarber?: boolean; // Fine barberpole phaser range (±12 Hz precision)

  // Tab 3 — Phase & Warp 3: REESE MIRROR NOTCH & PHASER (Violet)
  reesePower?: boolean;
  reeseDepth?: number; // 0 to 100 % opposing twin notch & peak depth
  reeseSweep?: number; // 0 to 100 % mirror fold span

  // Tab 3 — Phase & Warp 4: TURNTABLE VINYL SCRATCH & BRAKE (Amber)
  scratchPower?: boolean;
  scratchAmount?: number; // 0 to 100 % varispeed curve scrub + stylus grit
  vinylBrake?: boolean; // Motorized turntable tape-stop brake

  // Tab 3 — Phase & Warp 5: OSCILLOSCOPE PHASE SCOPE & STEREO ALIGNMENT (> Xover)
  phaseAlignDeg?: number; // -180 to +180 deg right-channel all-pass phase rotation (> Xover)
  phaseInvertR?: boolean; // Invert right-channel polarity (> Xover)
  phaseScopeMode?: PhaseScopeMode; // 'goniometer' (M/S) or 'lissajous' (X/Y)
  phaseScopeFreeze?: boolean; // Freeze oscilloscope trace for inspection

  // Tab 4 — Space & OTT 1: SPECTRAL GATE FILTERBANK (Cyan)
  spectralPower?: boolean;
  spectralMix?: number; // 0 to 100 % gated vocoder bank mix
  spectralThresh?: number; // 0 to 100 % dynamic band gate threshold
  spectralReso?: number; // 0 to 100 % filterbank harmonic Q

  // Tab 4 — Space & OTT 2: STEREO HAAS & DIMENSION (> Xover Mono-Sub Safe) (Blue)
  haasPower?: boolean;
  haasWidth?: number; // 0 to 100 % stereo dimension & Haas width
  haasDelayMs?: number; // 2 to 22 ms right-ear Haas offset
  haasDetune?: number; // 0 to 100 % stereo chorus modulation depth
  haasMonoCheck?: boolean; // Audition mono sum for phase verification

  // Tab 4 — Space & OTT 3: SUB-HARMONIC TRANSIENT THUMP (Amber)
  thumpPower?: boolean;
  thumpAmount?: number; // 0 to 100 % 808/kick attack pitch-drop punch
  thumpMode?: SubThumpMode;

  // Tab 4 — Space & OTT 4: TRUE 3-BAND UPWARD/DOWNWARD OTT (Emerald)
  ottPower?: boolean;
  ottAmount?: number; // 0 to 100 % multiband upward/downward depth
  ottMode?: OttFlavorMode;

  // Keyboard & Synth 4-Stage ADSR + Synth LFO Performance
  octave: number; // Base octave 0..4
  glideMs: number; // 0 to 350 ms portamento
  attackMs: number; // 5 to 600 ms synth amp & filter attack
  decayMs?: number; // 40 to 1500 ms synth amp & filter decay
  sustain?: number; // 0 to 100 % synth sustain plateau
  releaseMs: number; // 40 to 1500 ms synth amp & filter release
  synthAdsrFilterMod?: boolean; // Couple Synth ADSR contour to dynamic filter & growl drive
  synthLfoPower?: boolean;
  synthLfoShape?: KickLfoShape; // 'SINE' | 'TRI' | 'SAW' | 'SQR'
  synthLfoTarget?: SynthLfoTarget; // 'GROWL' | 'VOWEL' | 'FILTER' | 'PITCH' | 'AMP'
  synthLfoRateHz?: number; // 0.1 to 24.0 Hz LFO speed
  synthLfoDepth?: number; // 0 to 100 % LFO modulation depth
  synthLfoSync?: boolean; // Retrigger LFO phase on Note-On vs free-running
  basePitchSemitones: number; // -12 to +12 master transpose
  latchMode: boolean;

  // Tab 1 — Module 3: TONE & MULTIBAND WAVEFOLD (Amber Tube)
  tonePower: boolean;
  toneDrive: number; // 0 to 100 %
  toneMode: ToneMode;

  // Tab 1 — Module 4: STABILISE & OTT PUNCH (Violet Scope)
  spacePower: boolean;
  spaceAmount: number; // 0 to 100 %

  // Persistent Bottom Utility Strip
  hpFreq: number; // 20 - 400 Hz
  lpFreq: number; // 800 - 20000 Hz
  dryWet: number; // 0 - 100 %
  bypass: boolean;
}

export interface TelemetryFrame {
  phase: number;
  inMeter: number; // 0 - 1
  outMeter: number; // 0 - 1
  grainMeter: number; // 0 - 1
  growlMeter: number; // 0 - 1
  activeMidiNote: number | null;
  fftBins: Float32Array | null;
  scopeSamples: number[];
  masterWaveBars: number[];
  spectralBands: number[];
  ottBands: [number, number, number];
  disperserLiveHz: number;
  kickEqLiveHz: number;
  kickPumpMeter: number;
  kickEnvPhase: number;
  kickLfoPhase: number;
  synthEnvPhase: number;
  synthLfoPhase: number;
  // Live DSP Signal Analysis Readouts
  wahFreqHz: number;
  formantF1Hz: number;
  formantF2Hz: number;
  combDelayMs: number;
  fmModIndex: number;
  crushBits: number;
}
