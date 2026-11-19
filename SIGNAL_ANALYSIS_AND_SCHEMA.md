# Lunacy Growl (`nova.lunacy.audio`) — Signal Analysis & DSP Processing Schema

## 1. Reference Signal Analysis (`lunacy-growl` on Lunacy Audio NOVA)

Analysis of **Lunacy Audio's Growl** instrument on the NOVA platform (`https://nova.lunacy.audio/r/Bl459x4f0y2/lunacy-growl`) identifies five coupled acoustic mechanisms responsible for its vocal, metallic, chest-hitting tearout/neuro bass character:

1. **Cross-Coupled Multi-Operator FM Harmonics (FM Grid)**
   - Single-pair sine FM lacks upper-spectrum "bite" above `2.5 kHz`.
   - Pairing a **Primary Throaty FM Operator** (harmonic ratios `0.5x – 4.0x`, saw/square/triangle modulator) with a **Secondary Metallic High-Ratio FM Operator** (`3x` carrier-tracked ratio) generates dense sideband clusters across `250 Hz – 9 kHz` that feed downstream formant and comb filters.

2. **Phase-Coherent Multi-Band Sub Crossover (`115 Hz` Split)**
   - Passing `< 115 Hz` sub-bass fundamentals through resonant wah filters, comb delays, bitcrushers, and wavefolders causes severe **intermodulation distortion (IMD)** and phase cancellation, weakening low-end weight.
   - Splitting the spectrum at **`115 Hz`** isolates a clean, phase-locked low band (`20 – 115 Hz` + direct `-1 Octave` sine sub) while routing `> 115 Hz` mids and highs into extreme nonlinear growl mangling.

3. **The Central "Growl Macro" Coupled Multi-FX Trajectory**
   - Rather than static distortion, the signature "Growl" articulation comes from **simultaneously sweeping multiple coupled processors** from a single macro + envelope/LFO contour:
     - **Resonant Wah Pedal Sweep (`230 Hz → 2,750 Hz`, `Q = 4.2 – 9.4`)**: Sweeps a high-resonance peaking/wah formant across the vocal midrange.
     - **Pitch Inflection Micro-Sweep (`0 → +2.2 st`)**: Dynamically tightens oscillator pitch on modulation crests, mimicking vocal cord tension.
     - **Key-Tracked Metallic Throat Comb (`1.2 ms – 7.2 ms` Delay + Feedback)**: Short tuned delay feedback (`f_comb = 4 × f_note`) creates hollow robotic pipe/throat resonances that track chromatically across the keyboard.
     - **Vocal Formant Tract (`U → O → A → E → I`) + Inverse Neuro Notch (`1,950 Hz → 300 Hz`)**: Dual formant peaks (`F1`, `F2`) move opposite a deep surgical notch to create "talking" vowel-consonant contrast (`Yoi` / `Roar`).
     - **Staircase Bitcrusher / Quantizer**: Reduces effective bit resolution (`16-bit → 3.5-bit` quantized staircase transfer curve) ongrowl peaks, injecting crisp digital consonant sizzle into `2 kHz – 8 kHz`.

4. **Multi-Band Asymmetric Wavefolding & Saturation (`> 115 Hz` Only)**
   - Mid/high harmonics drive into a **Chebyshev Polynomial Wavefolder** followed by **Oversampled Asymmetric Clipping** (`TEAROUT`, `ROAR`, `YOI`, `SCREAM`, `TUBE`, `CLIP`) before recombining with the clean `< 115 Hz` sub band.

5. **OTT-Style 3-Band Spectral Sculpting & Dynamics**
   - Post-recombination 3-band shelving/mid sculptor (`+Low Punch`, `Mid Carve/Presence`, `+High Air`) feeds a fast-attack punch compressor and `-0.8 dBFS` brickwall safety limiter.

---

## 2. Complete DSP Processing Schema (Implemented Web Audio Graph)

```text
+---------------------------------------------------------------------------------------------------+
|                                   1. SOUND GENERATOR MATRIX                                       |
|                                                                                                   |
|  [OSC PANEL] Saw/Pulse(PWM)/Super/Sync/Tri + Osc2 Interval + RingMod(Osc1*Osc2) + Pink Noise      |
|       |                                                                                           |
|  [GRAIN ENGINE] Sample Buffer GrainPlayer (Cosine Spline Speed & Pitch Envelopes)                 |
|       |                                                                                           |
|  [DUAL-OP FM GROWL] Op1 Throaty FM + Op2 Metallic 3x FM + 3x Unison Saws + Macro Pitch Sweep      |
|       |                                                    |                                      |
|       +-----------------------+----------------------------+                                      |
|                               |                                                                   |
|                               v                                      [DIRECT -1 OCT SUB SINE]     |
|                        [INPUT GAIN (dB)]                                         |                |
+-------------------------------|--------------------------------------------------|----------------+
                                |                                                  |
          +---------------------+---------------------+                            |
          | (Dry Parallel Tap)                        | (Wet Processing Path)      |
          |                                           v                            |
          |                                 [HPF 20-400Hz] -> [LPF 0.8-20kHz]      |
          |                                           |                            |
          |                     +---------------------+---------------------+      |
          |                     | 115 Hz 24dB/oct                           |      |
          |                     v Low-Pass Split                            v High-Pass Split (>115 Hz)
          |        +-------------------------+                 +------------------------------------+
          |        | CLEAN SUB BAND (<115Hz) |                 |   2. LUNACY GROWL MACRO PIPELINE   |
          |        | Phase-Coherent Low End  |                 |                                    |
          |        | (Zero IMD / No Crush)   |                 |  [A] Resonant Wah Pedal (230-2.7k) |
          |        +-------------------------+                 |               |                    |
          |                     |                              |  [B] Key-Tracked Metallic Comb     |
          |                     |                              |      Delay (1.2-7.2ms, FB <= 0.76) |
          |                     |                              |               |                    |
          |                     |                              |  [C] Vocal Formants F1/F2 (U-O-A-E-I)
          |                     |                              |      + Counter-Swept Neuro Notch   |
          |                     |                              |               |                    |
          |                     |                              |  [D] Staircase Bitcrusher Shaper   |
          |                     |                              |      (Quantizer + Edge Harmonics)  |
          |                     |                              |               |                    |
          |                     |                              |  [E] Chebyshev Wavefolder          |
          |                     |                              |      + 2x Oversampled Distortion   |
          |                     |                              +------------------------------------+
          |                     |                                              |
          |                     +----------------------+-----------------------+
          |                                            |
          |                                            v
          |                                 [MULTIBAND RECOMBINER]
          |                                            |
          |                                  [3-BAND OTT SCULPTOR]
          |                                 (Low Punch / Mid / Air)
          |                                            |
          |                                  [STEREO SPACE REVERB]
          |                                            |
          v                                            v
     [DRY GAIN]                                   [WET GAIN]
          |                                            |
          +---------------------+----------------------+---------------------------+
                                |                                                  |
                                v                                                  |
                      [MASTER PUNCH COMPRESSOR] <----------------------------------+
                                |
                        [OUTPUT GAIN (dB)]
                                |
                   [BRICKWALL LIMITER (-0.8 dBFS)]
                                |
                    [LIVE FFT / WAVE / VU METERS] ---> [AUDIO DESTINATION]
```

---

## 3. Two-Tab Hardware Rack & Parameter-to-DSP Coupling Matrix

To keep every panel spacious and readable (5 modules per view), the hardware rack is divided into two pages:

### Tab 1: `Synth & Master` (5 Panels)
| Panel | Controls | Signal Path Role |
| :--- | :--- | :--- |
| **`OSC`** | `LEVEL`, Wave (`SAW`/`PULSE`/`SUPER`/`SYNC`/`TRI`), `SHAPE`, `DETUNE`, `NOISE`, RingMod, Interval | Primary multi-wave oscillator + PWM/Sync + RingMod + analog fizz |
| **`GRAIN`** | `SPEED`, `SIZE`/`DENS` LCD, `GRAIN`, `OVERLAP`, Reverse, Freeze | Cosine-spline envelope-tracked granular loop / custom audio layer |
| **`FM GROWL`** | `GROWL` Macro, `RATIO`/`NOTE` LCD, `WOBBLE`, `INFLECT`, `-1 Oct Sub`, Unison | Dual-operator FM carrier + metallic `3x` operator + `+2.6 st` vocal pitch inflection |
| **`TONE`** | `DRIVE`, Mode (`TEAROUT`/`ROAR`/`YOI`/`SCREAM`/`TUBE`/`CLIP`) | Order-5 Chebyshev wavefolder + `2x` oversampled asymmetric saturation |
| **`STABILISE`** | `PUNCH`, Transient Scope, `HP/LP`, `DRY/WET`, `BYPASS`, `PLAY` | Post-recombination 3-band OTT sculptor + stereo room + master glue compressor |

### Tab 2: `Growl FX Lab` (5 Dedicated Multiband Panels)
| Panel | Controls | Signal Path Role |
| :--- | :--- | :--- |
| **`WAH PEDAL`** | `WAH`, `BASE`/`LIVE` Hz LCD (`160–900 Hz`), `RES Q`, `SWEEP`, `Sub Solo` | High-$Q$ (`2.0–11.5`) resonant wah sweep strictly on `> Xover` band + `< Xover` sub solo |
| **`VOWEL TRACT`** | `VOWEL` (`U–O–A–E–I`), Formant Curve Display, `TALK`, `NOTCH`, Notch Toggle | Dual peaking vocal formants (`F1`/`F2`) + opposing surgical neuro notch (`180–3600 Hz`) |
| **`THROAT COMB`** | `METAL`, `HARM`/`DELAY` LCD (`1x–8x`), `FEEDBK`, `DAMP`, Key-Track Toggle | Chromatically key-tracked metallic comb delay (`1.1–8.0 ms`) with `1.2–11.4 kHz` HF loop damping |
| **`BITCRUSH`** | `CRUSH`, Live Staircase Bit-Depth Scope (`16.0b → 4.0b`) | Quantized staircase WaveShaper (`> Xover` only) for crisp aliasing edge with zero sub IMD |
| **`XOVER SUB`** | `SUB` Weight, `SPLIT`/`SLOPE` LCD (`60–240 Hz`, `24 dB/oct` LR4), `-1 Oct` Power | Phase-coherent 4th-order Linkwitz-Riley low/high crossover split (default `115 Hz`) |

