#!/bin/bash
set -e

echo "=========================================="
echo "  AWS Doorbell Setup Script"
echo "=========================================="
echo ""

# Get AWS region
read -p "Enter AWS region [us-east-1]: " REGION
REGION=${REGION:-us-east-1}

# Get channel name
read -p "Enter KVS channel name [doorbell-channel]: " CHANNEL_NAME
CHANNEL_NAME=${CHANNEL_NAME:-doorbell-channel}

# Get thing name
read -p "Enter IoT Thing name [doorbell-master]: " THING_NAME
THING_NAME=${THING_NAME:-doorbell-master}

# Get AWS credentials
echo ""
echo "Enter AWS credentials (for KVS access):"
read -p "AWS Access Key ID: " ACCESS_KEY_ID
read -sp "AWS Secret Access Key: " SECRET_ACCESS_KEY
echo ""

echo ""
echo "Creating AWS resources..."
echo ""

# Create KVS Signaling Channel
echo "1. Creating KVS Signaling Channel..."
CHANNEL_ARN=$(aws kinesisvideo create-signaling-channel \
    --channel-name $CHANNEL_NAME \
    --region $REGION \
    --query 'ChannelARN' \
    --output text 2>/dev/null || \
    aws kinesisvideo describe-signaling-channel \
    --channel-name $CHANNEL_NAME \
    --region $REGION \
    --query 'ChannelInfo.ChannelARN' \
    --output text)
echo "   Channel ARN: $CHANNEL_ARN"

# Create IoT Thing
echo "2. Creating IoT Thing..."
aws iot create-thing \
    --thing-name $THING_NAME \
    --region $REGION >/dev/null 2>&1 || echo "   Thing already exists"

# Create certificates
echo "3. Creating IoT certificates..."
mkdir -p master/certs
aws iot create-keys-and-certificate \
    --set-as-active \
    --certificate-pem-outfile master/certs/certificate.pem.crt \
    --public-key-outfile master/certs/public.pem.key \
    --private-key-outfile master/certs/private.pem.key \
    --region $REGION > master/certs/cert-info.json

CERT_ARN=$(jq -r '.certificateArn' master/certs/cert-info.json)
echo "   Certificate ARN: $CERT_ARN"

# Download root CA
echo "4. Downloading root CA certificate..."
curl -s -o master/certs/AmazonRootCA1.pem https://www.amazontrust.com/repository/AmazonRootCA1.pem

# Attach certificate to thing
echo "5. Attaching certificate to thing..."
aws iot attach-thing-principal \
    --thing-name $THING_NAME \
    --principal $CERT_ARN \
    --region $REGION

# Create IoT policy
echo "6. Creating IoT policy..."
POLICY_NAME="${THING_NAME}-policy"
aws iot create-policy \
    --policy-name $POLICY_NAME \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": ["iot:*"],
            "Resource": ["*"]
        }]
    }' \
    --region $REGION >/dev/null 2>&1 || echo "   Policy already exists"

# Attach policy to certificate
echo "7. Attaching policy to certificate..."
aws iot attach-policy \
    --policy-name $POLICY_NAME \
    --target $CERT_ARN \
    --region $REGION

# Get IoT endpoint
echo "8. Getting IoT endpoint..."
IOT_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region $REGION --query 'endpointAddress' --output text)
echo "   IoT Endpoint: $IOT_ENDPOINT"

# Create .env file
echo ""
echo "9. Creating .env file..."
cat > master/.env << EOF
export IOT_ENDPOINT=$IOT_ENDPOINT
export CERT_PATH=./certs/certificate.pem.crt
export KEY_PATH=./certs/private.pem.key
export CA_PATH=./certs/AmazonRootCA1.pem
export CLIENT_ID=$THING_NAME
export KVS_CHANNEL_NAME=$CHANNEL_NAME
export AWS_REGION=$REGION
EOF
echo "   Created master/.env"

# Create demo_config.h for C WebRTC application
echo "10. Creating demo_config.h..."
cat > master/linux-webrtc-reference-for-amazon-kinesis-video-streams/examples/app_common/demo_config.h << EOF
#ifndef DEMO_CONFIG_H
#define DEMO_CONFIG_H

// AWS Configuration
#define AWS_REGION "$REGION"
#define AWS_ACCESS_KEY_ID "$ACCESS_KEY_ID"
#define AWS_SECRET_ACCESS_KEY "$SECRET_ACCESS_KEY"
#define AWS_SESSION_TOKEN ""

// KVS Configuration
#define AWS_KVS_CHANNEL_NAME "$CHANNEL_NAME"
#define AWS_KVS_AGENT_NAME "$THING_NAME"
#define AWS_MAX_VIEWER_NUM 10

// Certificate paths
#define AWS_CA_CERT_PATH "./certs/AmazonRootCA1.pem"

// IoT Configuration (not used by WebRTC master)
#define IOT_THING_NAME "$THING_NAME"
#define IOT_CORE_CREDENTIAL_ENDPOINT ""
#define IOT_CORE_CERT ""
#define IOT_CORE_PRIVATE_KEY ""
#define IOT_CORE_ROOT_CA ""
#define IOT_CORE_ROLE_ALIAS ""

#endif
EOF
echo "   Created demo_config.h"

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Viewer Configuration (enter in browser):"
echo "  AWS Region: $REGION"
echo "  IoT Endpoint: $IOT_ENDPOINT"
echo "  MQTT Topic: doorbell/$CHANNEL_NAME/ring (auto-generated from channel)"
echo "  KVS Channel ARN: $CHANNEL_ARN"
echo "  AWS Access Key ID: $ACCESS_KEY_ID"
echo "  AWS Secret Access Key: $SECRET_ACCESS_KEY"
echo ""
echo "Next steps:"
echo "1. Build KVS WebRTC (REQUIRED - config was just generated):"
echo "   cd master/linux-webrtc-reference-for-amazon-kinesis-video-streams/build"
echo "   cmake .. && make"
echo "   cd ../../.."
echo ""
echo "2. Run master:"
echo "   cd master"
echo "   source .env"
echo "   python3 doorbell-master.py"
echo ""
echo "3. Run viewer:"
echo "   cd viewer"
echo "   python3 -m http.server 8000"
echo "   Open http://localhost:8000"
echo ""
