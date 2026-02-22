# GTCRN Speech Enhancement Integration Design

## Overview

Integrate GTCRN (Grouped Temporal Convolutional Recurrent Network) as a preprocessing step in the client audio pipeline to enhance voice audio quality before transmission.

## Approach

**ONNX Runtime** - Use pre-converted GTCRN model from sherpa-onnx releases. This avoids Python dependency and uses Microsoft's battle-tested inference engine.

## Integration Point

The enhancement will be inserted in the transmit path:

```
Microphone (48kHz) → [Resample to 16kHz] → [GTCRN ONNX] → [Resample back to 48kHz] → [VAD] → [Opus] → Network
```

## Architecture Components

### 1. SpeechEnhancementService
- Manages ONNX model loading and inference
- Handles model variant selection (DNS3 vs VCTK-DEMAND)
- Provides enable/disable toggle

### 2. GtcrnModel
- ONNX model wrapper using Microsoft.ML.OnnxRuntime
- Streaming inference support for real-time processing
- Thread-safe inference

### 3. Resampling
- Use NAudio's MediaFoundationResampler for 48kHz ↔ 16kHz conversion
- GTCRN expects 16kHz mono input

### 4. Configuration Integration
- Add enhancement settings to AppConfig
- Model variant selection (DNS3 / VCTK-DEMAND)
- Enable/disable toggle

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `enhancementEnabled` | bool | Toggle GTCRN enhancement on/off |
| `enhancementModel` | string | Model variant: "dns3" or "vctk-demand" |

## Key Considerations

### Latency
- GTCRN processes ~1-2ms per frame on modern CPU
- Well within 20ms buffer budget

### Buffering
- 20ms audio frames (960 samples @ 48kHz)
- Resample to 320 samples @ 16kHz for model
- Process through ONNX, resample back to 48kHz

### Threading
- Run inference on thread pool to avoid blocking audio thread
- Audio thread submits frames, enhancement runs async

### Model Source
- Download from sherpa-onnx releases: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speech-enhancement-models
- Models: `gtcrn-dns3-raw.onnx` and `gtcrn-vctk-demand-raw.onnx`

## File Structure

```
src/Brmble.Client/
├── Services/
│   └── SpeechEnhancement/
│       ├── SpeechEnhancementService.cs   # Main service
│       └── GtcrnModel.cs                 # ONNX model wrapper
```

## Implementation Steps

1. Add Microsoft.ML.OnnxRuntime NuGet package
2. Download GTCRN ONNX models
3. Create GtcrnModel wrapper class
4. Create SpeechEnhancementService
5. Integrate with AudioManager (transmit path)
6. Add configuration options
7. Test with various noise conditions

## References

- GTCRN Paper: https://ieeexplore.ieee.org/document/10448310
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
- ONNX Runtime: https://onnxruntime.ai/
