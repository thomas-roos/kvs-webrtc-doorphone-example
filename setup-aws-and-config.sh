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

# Ask if user wants to create dedicated IAM user
echo ""
read -p "Create dedicated IAM user with minimal permissions? [y/N]: " CREATE_USER
CREATE_USER=${CREATE_USER:-n}

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
if [ -z "$IOT_ENDPOINT" ] || [ "$IOT_ENDPOINT" = "None" ]; then
    echo "   Error: Failed to get IoT endpoint. Checking AWS credentials and region..."
    aws sts get-caller-identity --region $REGION
    exit 1
fi
echo "   IoT Endpoint: $IOT_ENDPOINT"

# Get IoT credentials endpoint
IOT_CRED_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:CredentialProvider --region $REGION --query 'endpointAddress' --output text)
echo "   IoT Credentials Endpoint: $IOT_CRED_ENDPOINT"

# Get IoT Core endpoint for MQTT
IOT_CORE_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region $REGION --query 'endpointAddress' --output text)
echo "   IoT Core Endpoint: $IOT_CORE_ENDPOINT"

# Create IAM role for KVS access
echo "9. Creating IAM role for KVS..."
ROLE_NAME="${THING_NAME}-kvs-role"
aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "credentials.iot.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }' >/dev/null 2>&1 || echo "   Role already exists"

# Attach KVS policy to role
aws iam attach-role-policy \
    --role-name $ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/AmazonKinesisVideoStreamsFullAccess

ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
echo "   Role ARN: $ROLE_ARN"

# Create dedicated IAM user if requested
if [[ "$CREATE_USER" =~ ^[Yy]$ ]]; then
    echo "10. Creating dedicated IAM user..."
    USER_NAME="${THING_NAME}-user"
    
    # Create user
    aws iam create-user \
        --user-name $USER_NAME \
        --tags Key=Purpose,Value=DoorbellSystem >/dev/null 2>&1 || echo "   User already exists"
    
    # Create minimal policy for doorbell system
    POLICY_NAME="${THING_NAME}-minimal-policy"
    aws iam create-policy \
        --policy-name $POLICY_NAME \
        --policy-document '{
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "kinesisvideo:DescribeSignalingChannel",
                        "kinesisvideo:GetSignalingChannelEndpoint",
                        "kinesisvideo:GetIceServerConfig",
                        "kinesisvideo:ConnectAsMaster",
                        "kinesisvideo:ConnectAsViewer"
                    ],
                    "Resource": "'$CHANNEL_ARN'"
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "iot:Connect",
                        "iot:Subscribe",
                        "iot:Receive",
                        "iot:Publish"
                    ],
                    "Resource": [
                        "arn:aws:iot:'$REGION':*:client/'$THING_NAME'*",
                        "arn:aws:iot:'$REGION':*:topic/doorbell/'$CHANNEL_NAME'/ring"
                    ]
                }
            ]
        }' >/dev/null 2>&1 || echo "   Policy already exists"
    
    # Attach policy to user
    POLICY_ARN=$(aws iam list-policies --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" --output text)
    aws iam attach-user-policy \
        --user-name $USER_NAME \
        --policy-arn $POLICY_ARN
    
    # Create access keys
    ACCESS_KEY_OUTPUT=$(aws iam create-access-key --user-name $USER_NAME --output json)
    ACCESS_KEY_ID=$(echo $ACCESS_KEY_OUTPUT | jq -r '.AccessKey.AccessKeyId')
    SECRET_ACCESS_KEY=$(echo $ACCESS_KEY_OUTPUT | jq -r '.AccessKey.SecretAccessKey')
    
    echo "   User: $USER_NAME"
    echo "   Access Key ID: $ACCESS_KEY_ID"
    echo "   Secret Access Key: [HIDDEN - see config files]"
    
    # Save credentials securely
    echo "$ACCESS_KEY_OUTPUT" > viewer/aws-credentials.json
    chmod 600 viewer/aws-credentials.json
else
    echo "10. Skipping IAM user creation (using existing credentials)"
    ACCESS_KEY_ID="[Enter your AWS Access Key ID]"
    SECRET_ACCESS_KEY="[Enter your AWS Secret Access Key]"
fi

# Create IoT Role Alias
echo "11. Creating IoT Role Alias..."
ROLE_ALIAS="${THING_NAME}-role-alias"
aws iot create-role-alias \
    --role-alias $ROLE_ALIAS \
    --role-arn $ROLE_ARN \
    --region $REGION >/dev/null 2>&1 || echo "   Role alias already exists"
echo "   Role Alias: $ROLE_ALIAS"

# Create .env file
echo ""
echo "12. Creating .env file..."
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

# Create viewer settings file for manual reference
echo "13. Creating viewer settings file..."
cat > viewer/settings.txt << EOF
VIEWER CONFIGURATION SETTINGS
=============================

Copy these values into the viewer web interface:

AWS Region: $REGION
IoT Endpoint: $IOT_ENDPOINT
KVS Channel ARN: $CHANNEL_ARN

AWS Credentials:
Access Key ID: $ACCESS_KEY_ID
Secret Access Key: $SECRET_ACCESS_KEY
Session Token: [Optional - only if using temporary credentials]

MQTT Topic (auto-generated): doorbell/$CHANNEL_NAME/ring
EOF
echo "   Created viewer/settings.txt"

# Create demo_config.h for C WebRTC application
echo "14. Creating demo_config.h..."
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

# Create AmebaProII demo_config.h
echo "15. Creating AmebaProII demo_config.h..."
mkdir -p master-amebapro/doorphone-master/examples/demo_config

# Copy template as base
cp master-amebapro/doorphone-master/examples/demo_config/demo_config_template.h \
   master-amebapro/doorphone-master/examples/demo_config/demo_config.h

# Update region and channel
sed -i "s|#define AWS_REGION \"us-west-2\"|#define AWS_REGION \"$REGION\"|g" \
    master-amebapro/doorphone-master/examples/demo_config/demo_config.h
sed -i "s|#define AWS_KVS_CHANNEL_NAME \"\"|#define AWS_KVS_CHANNEL_NAME \"$CHANNEL_NAME\"|g" \
    master-amebapro/doorphone-master/examples/demo_config/demo_config.h

# Add AWS IoT Core endpoint after the region line
sed -i "/^#define AWS_REGION/a #define AWS_IOT_CORE_ENDPOINT \"$IOT_CORE_ENDPOINT\"" \
    master-amebapro/doorphone-master/examples/demo_config/demo_config.h

# Enable IoT endpoints
sed -i "s|// #define AWS_CREDENTIALS_ENDPOINT \"\"|#define AWS_CREDENTIALS_ENDPOINT \"$IOT_CRED_ENDPOINT\"|g" \
    master-amebapro/doorphone-master/examples/demo_config/demo_config.h
sed -i "s|// #define AWS_IOT_CORE_ENDPOINT \"\"|#define AWS_IOT_CORE_ENDPOINT \"$IOT_CORE_ENDPOINT\"|g" \
    master-amebapro/doorphone-master/examples/demo_config/demo_config.h
sed -i "s|// #define AWS_IOT_THING_NAME \"\"|#define AWS_IOT_THING_NAME \"$THING_NAME\"|g" \
    master-amebapro/doorphone-master/examples/demo_config/demo_config.h
sed -i "s|// #define AWS_IOT_THING_ROLE_ALIAS \"\"|#define AWS_IOT_THING_ROLE_ALIAS \"$ROLE_ALIAS\"|g" \
    master-amebapro/doorphone-master/examples/demo_config/demo_config.h

# Create certificates as multi-line C string literals
cat >> master-amebapro/doorphone-master/examples/demo_config/demo_config.h << 'EOF'

#define AWS_IOT_THING_CERT \
EOF

awk '{print "    \"" $0 "\\n\" \\"}' master/certs/certificate.pem.crt | sed '$ s/ \\$//' >> master-amebapro/doorphone-master/examples/demo_config/demo_config.h

cat >> master-amebapro/doorphone-master/examples/demo_config/demo_config.h << 'EOF'

#define AWS_IOT_THING_PRIVATE_KEY \
EOF

awk '{print "    \"" $0 "\\n\" \\"}' master/certs/private.pem.key | sed '$ s/ \\$//' >> master-amebapro/doorphone-master/examples/demo_config/demo_config.h

# Add doorbell-specific configuration
cat >> master-amebapro/doorphone-master/examples/demo_config/demo_config.h << EOF

/* Doorbell Configuration */
#define CLIENT_ID               "doorbell-master-ameba"
#define DOORBELL_BUTTON_PIN     PB_31  /* AmebaProII Program Button */
#define MQTT_TOPIC              "doorbell/$CHANNEL_NAME/ring"

EOF

echo "   Created master-amebapro/doorphone-master/examples/demo_config/demo_config.h"

# Copy files to FreeRTOS project
#TODO echo "12. Integrating with FreeRTOS project..."
#TODO FREERTOS_PROJECT="master-amebapro/freertos-webrtc-amebapro/examples/master"
#TODO 
#TODO if [ -d "$FREERTOS_PROJECT" ]; then
#TODO     cp master-amebapro/doorbell_config.h $FREERTOS_PROJECT/
#TODO     cp master-amebapro/doorbell_master.c $FREERTOS_PROJECT/
#TODO     
#TODO     # Add task creation to master.c if not already present
#TODO     if ! grep -q "doorbellMasterTask" $FREERTOS_PROJECT/master.c; then
#TODO         # Add include at top
#TODO         sed -i '1i #include "doorbell_master.c"' $FREERTOS_PROJECT/master.c
#TODO         
#TODO         # Add task creation before main loop
#TODO         sed -i '/app_main\|int main/a \    xTaskCreate(doorbellMasterTask, "Doorbell", 2048, NULL, 5, NULL);' $FREERTOS_PROJECT/master.c
#TODO         
#TODO         echo "   Modified master.c"
#TODO     fi
#TODO     
#TODO     echo "   Files copied to FreeRTOS project"
#TODO else
#TODO     echo "   FreeRTOS project not found, files ready in master-amebapro/"
#TODO fi

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "VIEWER CONFIGURATION:"
echo "=========================================="
echo "Region: $REGION"
echo "IoT Endpoint: $IOT_ENDPOINT"
echo "KVS Channel ARN: $CHANNEL_ARN"
echo "MQTT Topic: doorbell/$CHANNEL_NAME/ring"
echo ""
echo "AWS Credentials (you need to provide these):"
echo "Access Key ID: [Enter your AWS Access Key ID]"
echo "Secret Access Key: [Enter your AWS Secret Access Key]"
echo "Session Token: [Optional - only if using temporary credentials]"
echo ""
echo "Configuration saved to: viewer/settings.txt"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Build KVS WebRTC (REQUIRED - config was just generated):"
echo "   mkdir master/linux-webrtc-reference-for-amazon-kinesis-video-streams/build"
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
echo "   Open GitHub Pages URL or run locally:"
echo "   cd viewer && python3 -m http.server 8000"
echo "   Copy settings from viewer/settings.txt into the web interface"
echo ""
