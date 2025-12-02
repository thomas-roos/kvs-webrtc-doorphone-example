let signalingClient;
let peerConnection;
let mqttClient;
let dataChannel;
let CONFIG;

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
        AWS_SESSION_TOKEN: ''
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
    }
}

window.onerror = function(msg, url, line, col, error) {
    document.getElementById('status').textContent = 'JS Error: ' + msg;
    console.error('Error:', msg, 'at', url, line, col, error);
    return false;
};

async function connectMQTT() {
    document.getElementById('status').textContent = 'Connecting to MQTT...';
    
    AWS.config.region = CONFIG.AWS_REGION;
    AWS.config.credentials = new AWS.Credentials(
        CONFIG.AWS_ACCESS_KEY_ID,
        CONFIG.AWS_SECRET_ACCESS_KEY,
        CONFIG.AWS_SESSION_TOKEN
    );
    
    const clientId = 'viewer-' + Date.now();
    const endpoint = `wss://${CONFIG.IOT_ENDPOINT}/mqtt`;
    
    const url = AWS.util.url.parse(endpoint);
    const datetime = AWS.util.date.iso8601(new Date()).replace(/[:\-]|\.\d{3}/g, '');
    const date = datetime.substr(0, 8);
    
    const credentials = AWS.config.credentials;
    const method = 'GET';
    const protocol = url.protocol;
    const host = url.host;
    const path = url.path;
    const queryParams = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(credentials.accessKeyId + '/' + date + '/' + CONFIG.AWS_REGION + '/iotdevicegateway/aws4_request')}&X-Amz-Date=${datetime}&X-Amz-SignedHeaders=host`;
    
    const canonicalRequest = method + '\n' + path + '\n' + queryParams + '\nhost:' + host + '\n\nhost\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const stringToSign = 'AWS4-HMAC-SHA256\n' + datetime + '\n' + date + '/' + CONFIG.AWS_REGION + '/iotdevicegateway/aws4_request\n' + AWS.util.crypto.sha256(canonicalRequest, 'hex');
    
    const signingKey = AWS.util.crypto.hmac(
        AWS.util.crypto.hmac(
            AWS.util.crypto.hmac(
                AWS.util.crypto.hmac('AWS4' + credentials.secretAccessKey, date, 'buffer'),
                CONFIG.AWS_REGION, 'buffer'),
            'iotdevicegateway', 'buffer'),
        'aws4_request', 'buffer');
    
    const signature = AWS.util.crypto.hmac(signingKey, stringToSign, 'hex');
    const signedUrl = protocol + '//' + host + path + '?' + queryParams + '&X-Amz-Signature=' + signature;
    
    mqttClient = new Paho.MQTT.Client(signedUrl, clientId);
    
    mqttClient.onMessageArrived = (message) => {
        const data = JSON.parse(message.payloadString);
        console.log('MQTT message received:', data);
        if (data.event === 'ring') {
            showRingNotification(data.channel);
        }
    };
    
    mqttClient.onConnectionLost = () => {
        console.log('MQTT connection lost');
        document.getElementById('status').textContent = 'MQTT disconnected';
    };
    
    mqttClient.connect({
        useSSL: true,
        timeout: 3,
        mqttVersion: 4,
        onSuccess: () => {
            console.log('MQTT connected');
            mqttClient.subscribe(CONFIG.TOPIC);
            document.getElementById('status').textContent = 'Monitoring for doorbell...';
            console.log('Monitoring for doorbell rings...');
        },
        onFailure: (err) => {
            console.error('MQTT connection failed:', err);
            document.getElementById('status').textContent = 'MQTT connection failed';
        }
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

async function joinChannel(channelName) {
    document.getElementById('status').textContent = 'Joining channel...';
    console.log('Joining channel:', channelName);

    AWS.config.region = CONFIG.AWS_REGION;
    AWS.config.credentials = new AWS.Credentials(
        CONFIG.AWS_ACCESS_KEY_ID,
        CONFIG.AWS_SECRET_ACCESS_KEY,
        CONFIG.AWS_SESSION_TOKEN
    );

    const kinesisVideoClient = new AWS.KinesisVideo({ region: CONFIG.AWS_REGION });
    const endpoint = await kinesisVideoClient.getSignalingChannelEndpoint({
        ChannelARN: channelName,
        SingleMasterChannelEndpointConfiguration: {
            Protocols: ['WSS', 'HTTPS'],
            Role: 'VIEWER'
        }
    }).promise();

    const endpointsByProtocol = endpoint.ResourceEndpointList.reduce((endpoints, endpoint) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
    }, {});
    
    console.log('Endpoints:', endpointsByProtocol);

    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
        region: CONFIG.AWS_REGION,
        endpoint: endpointsByProtocol.HTTPS
    });

    const iceServers = await kinesisVideoSignalingChannelsClient.getIceServerConfig({
        ChannelARN: channelName
    }).promise();

    signalingClient = new KVSWebRTC.SignalingClient({
        channelARN: channelName,
        channelEndpoint: endpointsByProtocol.WSS,
        clientId: 'viewer-' + Date.now(),
        role: KVSWebRTC.Role.VIEWER,
        region: CONFIG.AWS_REGION,
        credentials: AWS.config.credentials
    });

    const configuration = {
        iceServers: iceServers.IceServerList.map(server => ({
            urls: server.Uris,
            username: server.Username,
            credential: server.Password
        }))
    };

    peerConnection = new RTCPeerConnection(configuration);

    dataChannel = peerConnection.createDataChannel('commands');
    dataChannel.onopen = () => console.log('Data channel opened');
    dataChannel.onmessage = (event) => console.log('Received:', event.data);

    signalingClient.on('open', async () => {
        document.getElementById('status').textContent = 'Connected to channel';
        console.log('Signaling client connected');
        
        console.log('Creating SDP offer...');
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        console.log('Sending SDP offer to master');
        signalingClient.sendSdpOffer(peerConnection.localDescription);
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

    console.log('Opening signaling client...');
    signalingClient.open();
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
