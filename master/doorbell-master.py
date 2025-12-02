#!/usr/bin/env python3
import time
import json
import subprocess
import os
import threading
from awscrt import mqtt
from awsiot import mqtt_connection_builder

# AWS IoT Configuration
IOT_ENDPOINT = os.getenv("IOT_ENDPOINT")
CERT_PATH = os.getenv("CERT_PATH", "./certs/certificate.pem.crt")
KEY_PATH = os.getenv("KEY_PATH", "./certs/private.pem.key")
CA_PATH = os.getenv("CA_PATH", "./certs/AmazonRootCA1.pem")
CLIENT_ID = os.getenv("CLIENT_ID", "doorbell-master")

# KVS Configuration
CHANNEL_NAME = os.getenv("KVS_CHANNEL_NAME", "doorbell-channel")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
TOPIC = f"doorbell/{CHANNEL_NAME}/ring"
COMMAND_FILE = "/tmp/doorbell_commands.json"

def monitor_commands():
    """Monitor for commands from viewer"""
    last_mtime = 0
    while True:
        try:
            if os.path.exists(COMMAND_FILE):
                mtime = os.path.getmtime(COMMAND_FILE)
                if mtime > last_mtime:
                    with open(COMMAND_FILE, 'r') as f:
                        data = json.load(f)
                        if data.get('command') == 'OPEN_DOOR':
                            print("🔓 DOOR UNLOCKED")
                    last_mtime = mtime
        except:
            pass
        time.sleep(0.1)

def start_kvs_master():
    """Start KVS WebRTC master"""
    print("Starting KVS WebRTC master...")
    cmd = [
        "./linux-webrtc-reference-for-amazon-kinesis-video-streams/build/WebRTCLinuxApplicationGstMaster",
        CHANNEL_NAME
    ]
    env = os.environ.copy()
    env['AWS_DEFAULT_REGION'] = AWS_REGION
    subprocess.Popen(cmd, env=env)

def send_doorbell_ring(client):
    """Send MQTT message when doorbell is pressed"""
    message = {
        "event": "ring",
        "channel": CHANNEL_NAME,
        "timestamp": int(time.time())
    }
    
    client.publish(
        topic=TOPIC,
        payload=json.dumps(message),
        qos=mqtt.QoS.AT_LEAST_ONCE
    )
    print(f"Ring event published: {message}")

def main():
    if not IOT_ENDPOINT:
        print("Error: IOT_ENDPOINT environment variable not set")
        return
    
    # Start command monitoring thread
    threading.Thread(target=monitor_commands, daemon=True).start()
    
    mqtt_connection = mqtt_connection_builder.mtls_from_path(
        endpoint=IOT_ENDPOINT,
        cert_filepath=CERT_PATH,
        pri_key_filepath=KEY_PATH,
        ca_filepath=CA_PATH,
        client_id=CLIENT_ID,
        clean_session=False,
        keep_alive_secs=30
    )
    
    print("Connecting to AWS IoT...")
    connect_future = mqtt_connection.connect()
    connect_future.result()
    print("Connected!")

    print("Doorbell Master Ready")
    print("Press Enter to simulate doorbell button press (Ctrl+C to exit)")
    
    try:
        while True:
            input()
            print("Button pressed!")
            
            start_kvs_master()
            send_doorbell_ring(mqtt_connection)
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\nShutting down...")
        disconnect_future = mqtt_connection.disconnect()
        disconnect_future.result()

if __name__ == "__main__":
    main()
