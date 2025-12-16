# Video Rotation Implementation Plan

## Objective
Add video rotation capability to the doorbell video stream.

## Implementation Steps

1. **Create doorbell_config.h** - Configuration header for doorbell-specific settings
2. **Modify video parameters** - Add rotation field to videoParams in ameba_pro2_media_port.c
3. **Test rotation values** - Common values: 0°, 90°, 180°, 270°

## Video Rotation Values
- 0: No rotation (default)
- 90: 90° clockwise
- 180: 180° rotation  
- 270: 270° clockwise (90° counter-clockwise)

## Files Modified
- `examples/doorbell_config.h` (new)
- `examples/app_media_source/port/ameba_pro2/ameba_pro2_media_port.c`

## Embedded Constraints
- Minimal memory impact
- No performance degradation
- Hardware-accelerated rotation via video encoder
