# Implementation Plan

- [ ] 1. Set up LED controller infrastructure
  - Create LED controller module with GPIO configuration functions
  - Define LED state management structures and enums
  - Implement GPIO pin initialization and error handling
  - _Requirements: 2.1, 2.2_

- [ ]* 1.1 Write property test for GPIO initialization
  - **Property 5: Error handling resilience**
  - **Validates: Requirements 2.2**

- [ ] 2. Implement LED timing and control logic
  - Create FreeRTOS timer for 3-second LED duration
  - Implement LED activation and deactivation functions
  - Add timer reset logic for multiple commands within window
  - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [ ]* 2.1 Write property test for LED activation timing
  - **Property 1: LED activation timing**
  - **Validates: Requirements 1.2**

- [ ]* 2.2 Write property test for LED duration consistency
  - **Property 2: LED duration consistency**
  - **Validates: Requirements 1.3**

- [ ]* 2.3 Write property test for automatic LED shutoff
  - **Property 3: Automatic LED shutoff and reactivation readiness**
  - **Validates: Requirements 1.4**

- [ ]* 2.4 Write property test for timer reset behavior
  - **Property 4: Timer reset behavior**
  - **Validates: Requirements 1.5**

- [ ] 3. Integrate LED control with existing door command processing
  - Modify existing WebRTC data channel message handler
  - Add LED activation call to door unlock command processing
  - Ensure both door unlock and LED activation use same command
  - _Requirements: 3.1, 3.5_

- [ ]* 3.1 Write property test for unified command processing
  - **Property 8: Unified command processing**
  - **Validates: Requirements 3.1**

- [ ] 4. Add command validation and error handling
  - Implement input validation for door commands
  - Add error handling for malformed commands
  - Ensure LED state remains unchanged for invalid commands
  - _Requirements: 2.3_

- [ ]* 4.1 Write property test for invalid command rejection
  - **Property 6: Invalid command rejection**
  - **Validates: Requirements 2.3**

- [ ] 5. Implement logging and monitoring
  - Add logging for LED activation events with timestamps
  - Implement debug logging for LED state changes
  - Add error logging for GPIO and timer failures
  - _Requirements: 2.4_

- [ ]* 5.1 Write property test for command logging consistency
  - **Property 7: Command logging consistency**
  - **Validates: Requirements 2.4**

- [ ] 6. Add WebRTC connection lifecycle management
  - Implement LED cleanup on WebRTC disconnection
  - Add LED state reset on system restart/reboot
  - Ensure LED readiness after WebRTC connection establishment
  - _Requirements: 3.2, 3.3, 3.4_

- [ ]* 6.1 Write property test for disconnection cleanup
  - **Property 9: Disconnection cleanup**
  - **Validates: Requirements 3.3**

- [ ]* 6.2 Write property test for repeated activation capability
  - **Property 10: Repeated activation capability**
  - **Validates: Requirements 1.2, 1.3**

- [ ] 7. Update configuration and build system
  - Add LED GPIO pin configuration to demo_config.h
  - Update AmebaProII project build files to include LED controller
  - Add compile-time LED feature enable/disable flag
  - _Requirements: 2.5_

- [ ]* 7.1 Write unit tests for configuration handling
  - Test GPIO pin configuration with valid and invalid pins
  - Test feature enable/disable functionality
  - Test hardware detection and graceful degradation
  - _Requirements: 2.1, 2.5_

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Integration testing and validation
  - Test end-to-end LED functionality with web viewer
  - Validate timing accuracy with hardware measurement tools
  - Test multiple viewer scenarios and concurrent commands
  - Verify existing door unlock functionality remains unchanged
  - _Requirements: 1.1, 3.5_

- [ ]* 9.1 Write integration tests for end-to-end functionality
  - Test WebRTC data channel to LED activation flow
  - Test multiple command sequences and timing
  - Test error recovery and system resilience
  - _Requirements: 1.1, 1.5, 2.2_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.