# LED Door Indicator Design Document

## Overview

This design implements LED visual feedback functionality for the FreeRTOS-based doorbell system. When users press the "Open Door" button in the web viewer, an LED on the AmebaProII device will illuminate for 3 seconds, providing immediate visual confirmation that the command was received and processed.

The design leverages the existing WebRTC data channel communication without requiring changes to the web viewer interface, ensuring seamless integration with the current system architecture.

## Architecture

The LED control functionality integrates into the existing doorbell system architecture:

```
Web Viewer                    Master Device (AmebaProII)
┌─────────────────┐          ┌──────────────────────────┐
│ "Open Door"     │          │ WebRTC Data Channel      │
│ Button          │ ────────▶│ Message Handler          │
│                 │          │         │                │
└─────────────────┘          │         ▼                │
                             │ ┌─────────────────────┐  │
                             │ │ Door Command        │  │
                             │ │ Processor           │  │
                             │ │                     │  │
                             │ └─────────┬───────────┘  │
                             │           │              │
                             │           ▼              │
                             │ ┌─────────────────────┐  │
                             │ │ LED Controller      │  │
                             │ │ - GPIO Control      │  │
                             │ │ - Timer Management  │  │
                             │ │ - State Tracking    │  │
                             │ └─────────┬───────────┘  │
                             │           │              │
                             │           ▼              │
                             │ ┌─────────────────────┐  │
                             │ │ Physical LED        │  │
                             │ │ (GPIO Pin)          │  │
                             │ └─────────────────────┘  │
└──────────────────────────┘
```

## Components and Interfaces

### LED Controller Module

**Responsibilities:**
- GPIO pin configuration and control
- Timer-based LED state management with automatic shutoff
- State reset to allow repeated activations
- Error handling for hardware failures
- Integration with existing door command processing

**Interface:**
```c
typedef struct {
    gpio_num_t led_pin;
    bool is_initialized;
    bool is_active;
    TimerHandle_t led_timer;
} led_controller_t;

// Public API
esp_err_t led_controller_init(gpio_num_t pin);
esp_err_t led_controller_activate(void);
esp_err_t led_controller_deactivate(void);
bool led_controller_is_active(void);
void led_controller_cleanup(void);
```

### Door Command Handler Enhancement

**Current Flow:**
1. Receive WebRTC data channel message
2. Parse JSON command
3. Execute door unlock logic

**Enhanced Flow:**
1. Receive WebRTC data channel message
2. Parse JSON command
3. Execute door unlock logic
4. **NEW:** Activate LED indicator (or restart timer if already active)
5. **NEW:** Start/restart 3-second timer
6. **NEW:** After timer expires, turn off LED and reset state for next activation

### GPIO Configuration

**Hardware Requirements:**
- Available GPIO pin on AmebaProII
- LED with appropriate current limiting resistor
- Connection to ground

**Recommended Pin:** GPIO_PA_12 (configurable via demo_config.h)

## Data Models

### LED State Structure
```c
typedef enum {
    LED_STATE_OFF = 0,
    LED_STATE_ON = 1,
    LED_STATE_ERROR = -1
} led_state_t;

typedef struct {
    led_state_t current_state;
    uint32_t activation_count;
    uint32_t last_activation_time;
    bool timer_active;
} led_status_t;
```

### Configuration Structure
```c
typedef struct {
    gpio_num_t led_pin;
    uint32_t duration_ms;
    bool enabled;
    bool debug_logging;
} led_config_t;
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Property 1: LED activation timing
*For any* valid door unlock command, the LED should be illuminated within 100 milliseconds of command receipt
**Validates: Requirements 1.2**

Property 2: LED duration consistency  
*For any* LED activation, the LED should remain illuminated for exactly 3 seconds (±50ms tolerance)
**Validates: Requirements 1.3**

Property 3: Automatic LED shutoff and reactivation readiness
*For any* LED activation period, when the 3-second timer expires, the LED should automatically turn off and the system should be ready to accept new door commands
**Validates: Requirements 1.4**

Property 4: Timer reset behavior
*For any* sequence of door commands received within a 3-second window, the LED should remain on for 3 seconds from the timestamp of the most recent command
**Validates: Requirements 1.5**

Property 5: Error handling resilience
*For any* GPIO configuration failure or hardware error, the system should continue normal door unlock operations without LED functionality
**Validates: Requirements 2.2**

Property 6: Invalid command rejection
*For any* malformed or invalid door command, the LED state should remain unchanged from its current state
**Validates: Requirements 2.3**

Property 7: Command logging consistency
*For any* valid door command processed, a log entry with timestamp should be created documenting the LED activation event
**Validates: Requirements 2.4**

Property 8: Unified command processing
*For any* OPEN_DOOR command, both door unlock functionality and LED activation should be triggered by the same command message
**Validates: Requirements 3.1**

Property 9: Disconnection cleanup
*For any* WebRTC data channel disconnection event, if the LED is currently illuminated, it should be turned off immediately
**Validates: Requirements 3.3**

Property 10: Repeated activation capability
*For any* door command received after the LED has automatically turned off, the LED should activate again with a fresh 3-second timer
**Validates: Requirements 1.2, 1.3**

## Error Handling

### GPIO Configuration Errors
- **Detection**: Check return values from GPIO configuration functions
- **Response**: Log error, disable LED functionality, continue normal operation
- **Recovery**: Retry GPIO configuration on next system restart

### Timer Management Errors
- **Detection**: Monitor FreeRTOS timer creation and management return codes
- **Response**: Fall back to polling-based timing if hardware timers unavailable
- **Recovery**: Attempt timer recreation on next LED activation

### Hardware Detection
- **Detection**: Test GPIO pin responsiveness during initialization
- **Response**: Gracefully disable LED features if hardware not present
- **Recovery**: No automatic recovery - requires hardware installation

### WebRTC Communication Errors
- **Detection**: Monitor data channel state and message parsing
- **Response**: Ignore malformed commands, maintain current LED state
- **Recovery**: Continue processing subsequent valid commands

## Testing Strategy

### Unit Testing Approach
Unit tests will verify specific examples and edge cases:
- GPIO initialization with valid/invalid pins
- Timer creation and cleanup
- Command parsing with known good/bad inputs
- State transitions during normal operation

### Property-Based Testing Approach
Property-based tests will verify universal behaviors across all inputs using **fast-check** (JavaScript) for integration tests and custom C generators for embedded unit tests:

- **Timing Properties**: Generate random command sequences and verify LED timing behavior
- **State Properties**: Generate random system states and verify LED state consistency  
- **Error Properties**: Generate various error conditions and verify graceful handling
- **Integration Properties**: Generate random WebRTC message sequences and verify end-to-end behavior

Each property-based test will run a minimum of 100 iterations to ensure comprehensive coverage of the input space.

**Property Test Requirements:**
- Each correctness property must be implemented by a single property-based test
- Tests must be tagged with comments referencing the design document property
- Tag format: `**Feature: led-door-indicator, Property {number}: {property_text}**`
- Tests should run without mocking to validate real functionality

### Integration Testing
- End-to-end testing with actual WebRTC data channel communication
- Hardware-in-the-loop testing with physical LED and GPIO
- Timing verification using oscilloscope or logic analyzer
- Multi-viewer scenario testing

### Performance Testing
- LED activation latency measurement under various system loads
- Memory usage verification for timer and state management
- Power consumption impact assessment
- Concurrent command handling stress testing