// EXACT copy of working test viewer logic with MQTT integration
let viewer = {};
let mqttClient;
let CONFIG;

function log(message) {
    const console = document.getElementById('console-log');
    console.innerHTML += new Date().toLocaleTimeString() + ': ' + message + '\n';
    console.scrollTop = console.scrollHeight;
}

function saveConfigAndConnect() {
    const channelArn = document.getElementById('channelArn').value;
    const channelName = channelArn.split('/')[1];
    
    CONFIG = {
        AWS_REGION: document.getElementById('region').value,
        IOT_ENDPOINT: document.getElementById('iotEndpoint').value,
        TOPIC: `doorbell/${channelName}/ring`,
        CHANNEL_ARN: channelArn,
        AWS_ACCESS_KEY_ID: document.getElementById('accessKeyId').value,
        AWS_SECRET_ACCESS_KEY: document.getElementById('secretAccessKey').value,
        AWS_SESSION_TOKEN: document.getElementById('sessionToken').value || null
    };
    
    localStorage.setItem('doorbellConfig', JSON.stringify(CONFIG));
    
    document.getElementById('config-panel').style.display = 'none';
    document.getElementById('viewer-panel').style.display = 'block';
    
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

function connectMQTT() {
    try {
        log('AWS IoT SDK loaded, creating device connection...');
        
        mqttClient = awsIot.device({
            region: CONFIG.AWS_REGION,
            host: CONFIG.IOT_ENDPOINT,
            clientId: 'viewer-' + Date.now(),
            protocol: 'wss',
            maximumReconnectTimeMs: 8000,
            debug: false, // Reduce debug noise
            accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
            secretKey: CONFIG.AWS_SECRET_ACCESS_KEY
        });
        
        log('Device client created, setting up event handlers...');
        
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
            
            try {
                const message = JSON.parse(payload.toString());
                log('MQTT message received: ' + JSON.stringify(message));
                
                if (message.event === 'ring') {
                    showRingNotification();
                }
            } catch (e) {
                log('Error parsing MQTT message: ' + e.message);
            }
        });
        
        mqttClient.on('error', (error) => {
            log('MQTT error: ' + error.message);
            log('MQTT error details: ' + JSON.stringify(error));
        });
        
        mqttClient.on('offline', () => {
            log('MQTT offline');
        });
        
        mqttClient.on('reconnect', () => {
            log('MQTT reconnecting...');
        });
        
    } catch (error) {
        log('Error setting up MQTT: ' + error.message);
    }
}

function showRingNotification() {
    const notification = document.getElementById('ring-notification');
    notification.style.display = 'block';
    document.getElementById('status').textContent = 'Someone is at the door!';
    
    document.getElementById('pickup-btn').onclick = () => {
        notification.style.display = 'none';
        startViewer();
    };
}

// EXACT copy of working test viewer WebRTC logic
async function startViewer() {
    try {
        const formValues = {
            region: CONFIG.AWS_REGION,
            channelArn: CONFIG.CHANNEL_ARN,
            accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
            secretAccessKey: CONFIG.AWS_SECRET_ACCESS_KEY,
            sessionToken: CONFIG.AWS_SESSION_TOKEN,
            clientId: 'viewer-' + Math.random().toString(36).substr(2, 9)
        };
        
        // Debug credentials exactly
        log('DEBUG - Region: ' + formValues.region);
        log('DEBUG - AccessKeyId: ' + (formValues.accessKeyId ? 'Present (' + formValues.accessKeyId.length + ' chars)' : 'Missing'));
        log('DEBUG - SecretAccessKey: ' + (formValues.secretAccessKey ? 'Present (' + formValues.secretAccessKey.length + ' chars)' : 'Missing'));
        log('DEBUG - SessionToken: ' + formValues.sessionToken + ' (type: ' + typeof formValues.sessionToken + ')');
        
        log('Starting viewer with channel: ' + formValues.channelArn);
        
        // Create KinesisVideo client
        const kinesisVideoClient = new AWS.KinesisVideo.KinesisVideoClient({
            region: formValues.region,
            credentials: {
                accessKeyId: formValues.accessKeyId,
                secretAccessKey: formValues.secretAccessKey,
                sessionToken: formValues.sessionToken,
            },
            correctClockSkew: true,
        });
        
        // Get signaling channel endpoint
        const channelName = formValues.channelArn.split('/')[1];
        log('Using channel name: ' + channelName);
        
        const describeSignalingChannelCommand = new AWS.KinesisVideo.DescribeSignalingChannelCommand({
            ChannelName: channelName
        });
        
        const describeSignalingChannelResponse = await kinesisVideoClient.send(describeSignalingChannelCommand);
        const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
        log('Channel ARN: ' + channelARN);
        
        const getSignalingChannelEndpointCommand = new AWS.KinesisVideo.GetSignalingChannelEndpointCommand({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role: KVSWebRTC.Role.VIEWER,
            },
        });
        
        const getSignalingChannelEndpointResponse = await kinesisVideoClient.send(getSignalingChannelEndpointCommand);
        
        const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
            endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
            return endpoints;
        }, {});
        
        log('Endpoints: ' + JSON.stringify(endpointsByProtocol));
        
        // Create signaling channels client
        const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignaling.KinesisVideoSignalingClient({
            region: formValues.region,
            credentials: {
                accessKeyId: formValues.accessKeyId,
                secretAccessKey: formValues.secretAccessKey,
                sessionToken: formValues.sessionToken,
            },
            endpoint: endpointsByProtocol.HTTPS,
            correctClockSkew: true,
        });
        
        // Get ICE server configuration
        const getIceServerConfigCommand = new AWS.KinesisVideoSignaling.GetIceServerConfigCommand({
            ChannelARN: channelARN,
        });
        
        const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient.send(getIceServerConfigCommand);
        
        const iceServers = [];
        iceServers.push({ urls: `stun:stun.kinesisvideo.${formValues.region}.amazonaws.com:443` });
        if (getIceServerConfigResponse.IceServerList) {
            getIceServerConfigResponse.IceServerList.forEach(iceServer =>
                iceServers.push({
                    urls: iceServer.Uris,
                    username: iceServer.Username,
                    credential: iceServer.Password,
                }),
            );
        }
        
        log('ICE servers configured');
        
        // Create signaling client - EXACT copy from working test page
        viewer.signalingClient = new KVSWebRTC.SignalingClient({
            channelARN,
            channelEndpoint: endpointsByProtocol.WSS,
            clientId: formValues.clientId,
            role: KVSWebRTC.Role.VIEWER,
            region: formValues.region,
            credentials: {
                accessKeyId: formValues.accessKeyId,
                secretAccessKey: formValues.secretAccessKey,
                sessionToken: formValues.sessionToken,
            },
            requestSigner: {
                getSignedURL: async function(signalingEndpoint, queryParams, date) {
                    log('=== SIGNING DEBUG ===');
                    log('signalingEndpoint: ' + signalingEndpoint);
                    log('queryParams: ' + JSON.stringify(queryParams));
                    log('date: ' + date);
                    log('formValues.region: ' + formValues.region);
                    log('formValues.accessKeyId: ' + formValues.accessKeyId);
                    log('formValues.secretAccessKey length: ' + formValues.secretAccessKey.length);
                    log('formValues.sessionToken: ' + formValues.sessionToken + ' (type: ' + typeof formValues.sessionToken + ')');
                    
                    // Check crypto availability
                    log('window.crypto: ' + (window.crypto ? 'Available' : 'Missing'));
                    log('window.crypto.subtle: ' + (window.crypto && window.crypto.subtle ? 'Available' : 'Missing'));
                    log('location.protocol: ' + location.protocol);
                    log('location.hostname: ' + location.hostname);
                    
                    try {
                        const signer = new KVSWebRTC.SigV4RequestSigner(formValues.region, {
                            accessKeyId: formValues.accessKeyId,
                            secretAccessKey: formValues.secretAccessKey,
                            sessionToken: formValues.sessionToken,
                        });
                        
                        log('Signer created, calling getSignedURL...');
                        const retVal = await signer.getSignedURL(signalingEndpoint, queryParams, date);
                        log('URL signed successfully, length: ' + retVal.length);
                        return retVal;
                    } catch (error) {
                        log('SIGNING ERROR: ' + error.message);
                        log('SIGNING STACK: ' + error.stack);
                        throw error;
                    }
                }
            }
        });
        
        // Create peer connection
        viewer.peerConnection = new RTCPeerConnection({ iceServers });
        
        // Set up event handlers
        viewer.signalingClient.on('open', async () => {
            log('Signaling client connected');
            
            // Create offer
            const offer = await viewer.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await viewer.peerConnection.setLocalDescription(offer);
            log('Sending SDP offer');
            viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
        });
        
        viewer.signalingClient.on('sdpAnswer', async (answer) => {
            log('Received SDP answer');
            await viewer.peerConnection.setRemoteDescription(answer);
        });
        
        viewer.signalingClient.on('iceCandidate', candidate => {
            log('Received ICE candidate');
            viewer.peerConnection.addIceCandidate(candidate);
        });
        
        viewer.signalingClient.on('close', () => {
            log('Signaling client closed');
        });
        
        viewer.signalingClient.on('error', error => {
            log('Signaling client error: ' + error.message);
        });
        
        viewer.peerConnection.addEventListener('track', event => {
            log('Received media track');
            document.getElementById('video').srcObject = event.streams[0];
        });
        
        viewer.peerConnection.addEventListener('icecandidate', event => {
            if (event.candidate) {
                log('Sending ICE candidate');
                viewer.signalingClient.sendIceCandidate(event.candidate);
            }
        });
        
        // Start connection
        log('Opening signaling client...');
        viewer.signalingClient.open();
        
    } catch (error) {
        log('Error: ' + error.message);
        console.error(error);
    }
}

function closeCall() {
    if (viewer.signalingClient) {
        viewer.signalingClient.close();
        viewer.signalingClient = null;
    }
    if (viewer.peerConnection) {
        viewer.peerConnection.close();
        viewer.peerConnection = null;
    }
    document.getElementById('video').srcObject = null;
    document.getElementById('status').textContent = 'Monitoring for doorbell...';
    log('Call closed');
}

function openDoor() {
    log('Door unlock command sent');
}

// Load saved config on page load
loadConfig();
