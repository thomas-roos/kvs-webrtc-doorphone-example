let signalingClient;
let peerConnection;
let mqttClient;
let dataChannel;
let CONFIG;

function log(message) {
    const logDiv = document.getElementById('console-log');
    if (logDiv) {
        const timestamp = new Date().toLocaleTimeString();
        logDiv.innerHTML += `[${timestamp}] ${message}<br>`;
        logDiv.scrollTop = logDiv.scrollHeight;
    }
    console.log(message);
}

function saveConfigAndConnect() {
    const channelArn = document.getElementById('channelArn').value;
    const channelName = channelArn.split('/')[1]; // Extract channel name from ARN
    
    CONFIG = {
        AWS_REGION: document.getElementById('region').value,
        IOT_ENDPOINT: document.getElementById('iotEndpoint').value,
        TOPIC: `doorbell/${channelName}/ring`,
        CHANNEL_ARN: channelArn,
        AWS_ACCESS_KEY_ID: document.getElementById('accessKeyId').value,
        AWS_SECRET_ACCESS_KEY: document.getElementById('secretAccessKey').value,
        AWS_SESSION_TOKEN: document.getElementById('sessionToken').value || null
    };
    
    // Save to localStorage
    localStorage.setItem('doorbellConfig', JSON.stringify(CONFIG));
    
    // Hide config, show viewer
    document.getElementById('config-panel').style.display = 'none';
    document.getElementById('viewer-panel').style.display = 'block';
    
    // Connect
    connectMQTT();
}

function loadConfig() {
    const saved = localStorage.getItem('doorbellConfig');
    if (saved) {
        CONFIG = JSON.parse(saved);
        document.getElementById('region').value = CONFIG.AWS_REGION;
        document.getElementById('iotEndpoint').value = CONFIG.IOT_ENDPOINT;
        document.getElementById('channelArn').value = CONFIG.CHANNEL_ARN;
        document.getElementById('accessKeyId').value = CONFIG.AWS_ACCESS_KEY_ID;
        document.getElementById('secretAccessKey').value = CONFIG.AWS_SECRET_ACCESS_KEY;
        document.getElementById('sessionToken').value = CONFIG.AWS_SESSION_TOKEN || '';
    }
}

window.onerror = function(msg, url, line, col, error) {
    document.getElementById('status').textContent = 'JS Error: ' + msg;
    console.error('Error:', msg, 'at', url, line, col, error);
    return false;
};

async function connectMQTT() {
    document.getElementById('status').textContent = 'Connecting to MQTT...';
    
    // Debug: Check if awsIot is available
    if (typeof awsIot === 'undefined') {
        log('ERROR: awsIot SDK not loaded');
        document.getElementById('status').textContent = 'AWS IoT SDK not loaded';
        return;
    }
    
    log('AWS IoT SDK loaded, creating device connection...');
    
    try {
        mqttClient = awsIot.device({
            region: CONFIG.AWS_REGION,
            host: CONFIG.IOT_ENDPOINT,
            clientId: 'viewer-' + Date.now(),
            protocol: 'wss',
            maximumReconnectTimeMs: 8000,
            debug: true,
            accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
            secretKey: CONFIG.AWS_SECRET_ACCESS_KEY
        });
        
        log('Device client created, setting up event handlers...');
    } catch (error) {
        log('Error creating device client: ' + error.message);
        document.getElementById('status').textContent = 'Failed to create MQTT client';
        return;
    }
    
    mqttClient.on('connect', () => {
        log('MQTT connected');
        log('Subscribing to topic: ' + CONFIG.TOPIC);
        mqttClient.subscribe(CONFIG.TOPIC);
        document.getElementById('status').textContent = 'Monitoring for doorbell...';
        log('Monitoring for doorbell rings...');
    });
    
    mqttClient.on('message', (topic, payload) => {
        log('MQTT message received on topic: ' + topic);
        log('MQTT message payload: ' + payload.toString());
        const data = JSON.parse(payload.toString());
        log('MQTT message received: ' + JSON.stringify(data));
        if (data.event === 'ring') {
            showRingNotification(data.channel);
        }
    });
    
    mqttClient.on('error', (error) => {
        console.error('MQTT error:', error);
        document.getElementById('status').textContent = 'MQTT error: ' + error.message;
    });
    
    mqttClient.on('close', () => {
        console.log('MQTT connection lost');
        document.getElementById('status').textContent = 'MQTT disconnected';
    });
}

function showRingNotification(channelName) {
    const notification = document.getElementById('ring-notification');
    notification.style.display = 'block';
    
    document.getElementById('pickup-btn').onclick = () => {
        notification.style.display = 'none';
        joinChannel(CONFIG.CHANNEL_ARN);
    };
}

async function joinChannel(channelArn) {
    try {
        document.getElementById('status').textContent = 'Joining channel...';
        log('Joining channel: ' + channelArn);
        
        // Extract channel name from ARN for KVS operations
        const channelName = channelArn.split('/')[1];
        log('Using channel name: ' + channelName);

        log('Getting signaling channel endpoint...');
        const kinesisVideoClient = new AWS.KinesisVideo.KinesisVideoClient({
            region: CONFIG.AWS_REGION,
            credentials: {
                accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
                secretAccessKey: CONFIG.AWS_SECRET_ACCESS_KEY,
                sessionToken: CONFIG.AWS_SESSION_TOKEN || null,
            }
        });
        
        const getSignalingChannelEndpointCommand = new AWS.KinesisVideo.GetSignalingChannelEndpointCommand({
            ChannelARN: channelArn,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role: KVSWebRTC.Role.VIEWER
            }
        });
        
        const endpoint = await kinesisVideoClient.send(getSignalingChannelEndpointCommand);

        log('Got endpoint response, processing...');
        const endpointsByProtocol = endpoint.ResourceEndpointList.reduce((endpoints, endpoint) => {
            endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
            return endpoints;
        }, {});
        
        log('Endpoints: ' + JSON.stringify(endpointsByProtocol));

        log('Creating signaling channels client...');
        const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignaling.KinesisVideoSignalingClient({
            region: CONFIG.AWS_REGION,
            credentials: {
                accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
                secretAccessKey: CONFIG.AWS_SECRET_ACCESS_KEY,
                sessionToken: CONFIG.AWS_SESSION_TOKEN,
            },
            endpoint: endpointsByProtocol.HTTPS,
            correctClockSkew: true,
        });

        log('Getting ICE server config...');
        const getIceServerConfigCommand = new AWS.KinesisVideoSignaling.GetIceServerConfigCommand({
            ChannelARN: channelArn
        });
        
        const iceServers = await kinesisVideoSignalingChannelsClient.send(getIceServerConfigCommand);

        log('Creating signaling client...');
        
        // Debug credentials thoroughly
        log('Access Key ID: ' + (CONFIG.AWS_ACCESS_KEY_ID ? 'Present' : 'Missing'));
        log('Secret Key: ' + (CONFIG.AWS_SECRET_ACCESS_KEY ? 'Present' : 'Missing'));
        log('Session Token: ' + (CONFIG.AWS_SESSION_TOKEN ? 'Present' : 'Missing/Undefined'));
        log('Session Token value: ' + CONFIG.AWS_SESSION_TOKEN);
        
        signalingClient = new KVSWebRTC.SignalingClient({
            channelARN: channelArn,
            channelEndpoint: endpointsByProtocol.WSS,
            clientId: 'viewer-' + Math.random().toString(36).substr(2, 9),
            role: KVSWebRTC.Role.VIEWER,
            region: CONFIG.AWS_REGION,
            credentials: {
                accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
                secretAccessKey: CONFIG.AWS_SECRET_ACCESS_KEY,
                sessionToken: CONFIG.AWS_SESSION_TOKEN,
            },
            requestSigner: {
                getSignedURL: async function(signalingEndpoint, queryParams, date) {
                    const signer = new KVSWebRTC.SigV4RequestSigner(CONFIG.AWS_REGION, {
                        accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
                        secretAccessKey: CONFIG.AWS_SECRET_ACCESS_KEY,
                        sessionToken: CONFIG.AWS_SESSION_TOKEN,
                    });
                    
                    log('Signing URL...');
                    const retVal = await signer.getSignedURL(signalingEndpoint, queryParams, date);
                    log('URL signed successfully');
                    return retVal;
                }
            }
        });

        log('Creating peer connection...');
        const configuration = {
            iceServers: iceServers.IceServerList.map(server => ({
                urls: server.Uris,
                username: server.Username,
                credential: server.Password
            }))
        };

        peerConnection = new RTCPeerConnection(configuration);

        log('Creating data channel...');
        dataChannel = peerConnection.createDataChannel('commands');
        dataChannel.onopen = () => log('Data channel opened');
    dataChannel.onmessage = (event) => log('Received: ' + event.data);

    log('Setting up signaling client event handlers...');
    signalingClient.on('open', async () => {
        log('Signaling client connected');
        document.getElementById('status').textContent = 'Connected to channel';
        
        log('Creating SDP offer...');
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        log('Sending SDP offer to master');
        signalingClient.sendSdpOffer(peerConnection.localDescription);
    });

    signalingClient.on('error', (error) => {
        log('Signaling client error: ' + error.message);
        document.getElementById('status').textContent = 'Signaling error: ' + error.message;
    });

    signalingClient.on('close', () => {
        log('Signaling client closed');
    });

    signalingClient.on('sdpAnswer', async (answer) => {
        console.log('Received SDP answer from master');
        await peerConnection.setRemoteDescription(answer);
    });

    signalingClient.on('iceCandidate', candidate => {
        console.log('Received ICE candidate');
        peerConnection.addIceCandidate(candidate);
    });

    peerConnection.addEventListener('track', event => {
        console.log('Received media track!');
        document.getElementById('video').srcObject = event.streams[0];
        document.getElementById('status').textContent = 'Streaming...';
    });

    peerConnection.addEventListener('icecandidate', event => {
        if (event.candidate) {
            console.log('Sending ICE candidate');
            signalingClient.sendIceCandidate(event.candidate);
        }
    });

    peerConnection.addEventListener('connectionstatechange', () => {
        console.log('Connection state:', peerConnection.connectionState);
    });

    log('Opening signaling client...');
    signalingClient.open();
} catch (error) {
    console.error('Error joining channel:', error);
    document.getElementById('status').textContent = 'Failed to join channel: ' + error.message;
}
}

function closeCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (signalingClient) {
        signalingClient.close();
        signalingClient = null;
    }
    document.getElementById('video').srcObject = null;
    document.getElementById('status').textContent = 'Monitoring for doorbell...';
}

function openDoor() {
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ command: 'OPEN_DOOR' }));
        console.log('Sent OPEN_DOOR command');
    } else {
        console.log('Data channel not open');
    }
}

// Load saved config on page load
loadConfig();
