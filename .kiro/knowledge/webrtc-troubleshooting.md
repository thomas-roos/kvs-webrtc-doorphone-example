# WebRTC Troubleshooting for Doorbell System

## Critical Issue: "Cannot read properties of undefined (reading 'digest')" Error

### Problem
WebRTC signaling fails with digest error when using AWS KVS WebRTC SDK.

### Root Cause
The KVS WebRTC SDK requires Web Crypto APIs (`crypto.subtle`) for SigV4 request signing. These APIs are only available in secure contexts:
- HTTPS websites
- `localhost` (even over HTTP)
- NOT available with `0.0.0.0` or other IP addresses over HTTP

### Solution
**Always access the viewer via `http://localhost:8000` instead of `http://0.0.0.0:8000`**

### Technical Details
1. **Web Crypto API Requirement**: KVS WebRTC SDK uses `crypto.subtle.digest()` for SHA-256 hashing during SigV4 signing
2. **Secure Context**: Browser security policy restricts crypto APIs to secure contexts
3. **localhost Exception**: Browsers treat `localhost` as secure even over HTTP
4. **0.0.0.0 Limitation**: IP addresses (including 0.0.0.0) don't qualify as secure contexts

### Verification Steps
Check browser console for crypto API availability:
```javascript
console.log('window.crypto:', window.crypto ? 'Available' : 'Missing');
console.log('window.crypto.subtle:', window.crypto?.subtle ? 'Available' : 'Missing');
console.log('location.protocol:', location.protocol);
console.log('location.hostname:', location.hostname);
```

Expected output for working setup:
```
window.crypto: Available
window.crypto.subtle: Available
location.protocol: http:
location.hostname: localhost
```

### Error Stack Trace Pattern
```
TypeError: Cannot read properties of undefined (reading 'digest')
    at e.<anonymous> (kvs-webrtc.min.js:7:9134)
    at Object.next (kvs-webrtc.min.js:7:20791)
    at e.sha256 (kvs-webrtc.min.js:7:8998)
```

### Alternative Solutions
1. **Use HTTPS**: Serve the application over HTTPS
2. **Use localhost**: Always use `localhost` instead of IP addresses
3. **Proxy Setup**: Configure reverse proxy to serve on localhost

### Related Issues
- MQTT connections work fine with any hostname (no crypto API dependency)
- Only WebRTC signing is affected by secure context requirements
- Same credentials work in both contexts - issue is purely crypto API availability

### Testing
Use the isolated test to verify crypto API availability:
```html
<script>
async function testCrypto() {
    try {
        const signer = new KVSWebRTC.SigV4RequestSigner('us-east-1', {
            accessKeyId: 'test',
            secretAccessKey: 'test',
            sessionToken: null
        });
        console.log('Crypto APIs working');
    } catch (error) {
        console.error('Crypto API error:', error.message);
    }
}
</script>
```
