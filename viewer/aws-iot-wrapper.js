// Simple wrapper to expose AWS IoT Device SDK as global
const DeviceClient = require('./aws-iot-device-sdk-js/device/index.js');

// Create the awsIot object with device function like the original SDK
window.awsIot = {
    device: function(options) {
        return new DeviceClient(options);
    }
};
