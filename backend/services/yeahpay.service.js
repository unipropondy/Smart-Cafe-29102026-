// DEMO_2026_PONDY/backend/services/yeahpay.service.js

const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class YeahPayService {
    constructor() {
        this.serverPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAknPrvKrUs9vy6+Aef0Fz
nA/6AlAalatfsdG7PyN54GQgxv2PVLg/NIH99cvGhw6m0T7+GCkURQk+Di2UbBNH
VpbKlG7pZ+0YR1SyQcF/9vv8va8200DpMl0wOljuz6i75kDsMCR6RvteBHZOwN0v
lDm5Uo6D676QMhgliaTVE6hd3D1CXX1CfajoAYa05bCXkr+Qy01pAVmkKvM540kU
0kML5N2pkh9UByCvTEKf/G0J7MvgjQzepYf8+009ljSl1pGBuuJJLU9kExIHIbLi
PwhBiqprMb0HLFirVIJgEO0o/b4B5F/9jOZtk6dx1jwlxfidWKeIDFIhhItWM2ef
owIDAQAB
-----END PUBLIC KEY-----`;

        this.clientPrivateKeyPem = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5aUct6m37ok6h
jdcSMVAESR15MsGzy+nj674ZGmi5vFcx64ljjfyj4830uUJZSO6OdjA28dFi0lBF
FeSNtoC268VYN5NB4V3R09rTAd6CLLuKbe8pG5sTfA9Y98qST9g8UBYgMNje4CEC
9144zyyr1IQ3uLGV2Ddm/tR4CXa+iT+gy00c16XwFnWJPuYsrDbEHc4boQg7IkM4
kUHsFi5CpZLkj68xKYJ9KDxS3QocSFie69Yhn+3i7k+no9Ss1BYe0esLRUc4ayr6
iDkkDMZvOqMiZKnD1Wah+zI47rF7iG2LAmrmV0EaBr/D28JNvX46/X7qEbLysH1b
a16RlsBXAgMBAAECggEAHN5Dcua5USCoVYccIX0EFGa97Az3E+N/+zjNVGNEQwcM
HH2r2pBU8b+aZawipHwyiIPmZeeozlYooVkTSO1NhS2YgG/Gwc8xKGZv/8Kevm3w
lVEgl6nwr0v1p8iNBdLgvCNMDp8MZUdIXInfZcD8F5TzMSnUnJwZpDOxKS9wCaJZ
KQ254W1/nVISas7GbTL93+app0RjK2Z8KzxS9xeO/p7ortccqysE54kGQK0ZaE6a
rO3+GEx2Gfvk8bfXwHOvcbML1eNf3VHGOFaDAytPm5mCiMVK3XCn8I6weLho1uZo
A9nXzkr+dcNXqdmSj5k6xnCwPrf90ZAguX5nsLCyYQKBgQDcAHt8AYJlk7Gi7ysv
C3ZrYf7lcpVIacoly2HGSUjJ4nH/f13v6hS6nz+/MMEUpzxtX9dmHGv7aFf23iHB
9yA2vxg5O4Khteo+JUGmdZzReULrGYwHg2jVZS406z6nTKTk+5hp4foeLij+zIB6
I1ncMNxgiBH3t8gAjJu0PmUd6wKBgQDXv9m6csGBhP6R2iwro9V6oIbV2I/aUPOS
frwfU3XVBG5mZLKczKiZPTHm9njVTxzncddykm9/HLUU6H9ToXILMYAnZs+l/n+h
0QrhHXg3a/RajINxgxIDtajv3vn17eENRTTtCx4YkOa/7suqrsKB1aiHEM6+53dV
ILiN8qUQRQKBgQCkIEf/TzD0jqarIzpYMnj5y3XZvw3Xo/SHFZ+vyeRfmGvrbB2s
ajlksIFiJQEmY00VW7baGsIEIOfe6ADPL4n8zbtIlzjxY0GJc0ny4TNIouplcf2h
bUu8R2udVxK6xNcPbRNbipaKBW3YCMCgXdcgCeOesGSXJagzoLJYWWQeWQKBgAQP
HviMCin2p5d05FnZ1j1dYcwKLAKufTanXcC1IEVmtPEGOfoLO6zOYu72eiWBPIj6
MlR8fs6Ear++9A5NvkiJoOCc5ZE47YvM1AiSNl3MkSdW924eSit5snj41/kRhadr
QuimyeUqbLz1sC1A5nXs4CPSZCFhV3Rpji9VfleFAoGBALMtXeaU8lYECG+YoEFC
4tlufK0mItC8Onoh/D9PHFrkbN9k+p2BxFw04E9EDkPWNxMrl1+oBnLhumaAJC8c
BSm83tp76UCTjAid5ybSIcKhbpfnBWhlj69xbLmtBM7L309VDpfXTpdH+VwvKdp/
Mgo5r6wk1g3/psKWDtPmVOw5
-----END PRIVATE KEY-----`;
        
        this.syncUrl = 'https://business.yeahpay.sg/acceptance/acceptance-mis-pos/sync';
    }

    async processPayNowPayment({ amount, deviceSn, salt, appId }) {
        console.log('🔵 processPayNowPayment called');
        console.log('   Amount:', amount);
        console.log('   DeviceSN:', deviceSn);
        console.log('   Salt:', salt ? 'Yes' : 'No');
        console.log('   AppId:', appId);
        
        const requestData = {
            paymentRequest: {
                amount: amount.toString(),
                bizOrderId: `PAYNOW${Date.now()}${Math.random().toString(36).substr(2, 8)}`
            }
        };
        
        return await this.sendRequest({
            action: 'TRADE.QRCODE.PayNowPay',
            data: requestData,
            deviceSn, 
            salt, 
            appId
        });
    }

    async processCardPayment({ amount, deviceSn, salt, appId }) {
        console.log('🔵 processCardPayment called');
        console.log('   Amount:', amount);
        console.log('   DeviceSN:', deviceSn);
        console.log('   Salt:', salt ? 'Yes' : 'No');
        console.log('   AppId:', appId);
        
        const requestData = {
            paymentRequest: {
                amount: amount.toString(),
                bizOrderId: `CARD${Date.now()}${Math.random().toString(36).substr(2, 8)}`
            }
        };
        
        return await this.sendRequest({
            action: 'TRADE.CARD.CONSUME',
            data: requestData,
            deviceSn, 
            salt, 
            appId
        });
    }

    async sendRequest({ action, data, deviceSn, salt, appId }) {
        console.log(`[YeahPay] Sending ${action} for device ${deviceSn}`);
        
        const aesKey = crypto.randomBytes(16);
        const iv = crypto.randomBytes(16);
        
        const sortedData = this.sortObjectKeys(data);
        const dataJson = JSON.stringify(sortedData);
        
        const sign = crypto.createHash('sha256').update(salt + dataJson).digest('hex');
        
        const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
        let encryptedData = cipher.update(dataJson, 'utf8', 'hex');
        encryptedData += cipher.final('hex');
        
        let encryptedKey;
        try {
            console.log('RSA encrypting with public key...');
            encryptedKey = crypto.publicEncrypt(
                { key: this.serverPublicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
                aesKey
            ).toString('hex');
            console.log('RSA encryption success');
        } catch (err) {
            console.error('RSA encrypt error:', err.message);
            return { success: false, code: -1, msg: 'Encryption failed: ' + err.message };
        }
        
        const requestBody = {
            key: encryptedKey,
            data: encryptedData,
            messageHeader: {
                action, 
                deviceSn, 
                messageType: 'Request', 
                protocolVersion: '1.0',
                serviceId: uuidv4()
            },
            securityTrailer: { 
                cryptoVersion: '1.0', 
                nonce: iv.toString('hex'), 
                sign 
            }
        };
        
        try {
            console.log('Sending to YeahPay...');
            const response = await axios.post(this.syncUrl, requestBody, {
                headers: { 'Content-Type': 'application/json', 'appId': appId },
                timeout: 160000
            });
            console.log('Response received');
            
            const decryptedKey = crypto.privateDecrypt(
                { key: this.clientPrivateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
                Buffer.from(response.data.key, 'hex')
            );
            
            const decipher = crypto.createDecipheriv('aes-128-cbc', decryptedKey,
                Buffer.from(response.data.securityTrailer.nonce, 'hex'));
            let decryptedData = decipher.update(response.data.data, 'hex', 'utf8');
            decryptedData += decipher.final('utf8');
            
            const parsed = JSON.parse(decryptedData);
            console.log('[YeahPay] Response:', parsed);
            
            return { 
                success: parsed.code === 0, 
                code: parsed.code, 
                msg: parsed.msg, 
                data: parsed 
            };
        } catch (error) {
            console.error('YeahPay request error:', error.message);
            return { success: false, code: -1, msg: error.message };
        }
    }

    sortObjectKeys(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(i => this.sortObjectKeys(i));
        return Object.keys(obj).sort().reduce((r, k) => {
            if (obj[k] !== null && obj[k] !== undefined && obj[k] !== '')
                r[k] = this.sortObjectKeys(obj[k]);
            return r;
        }, {});
    }
}

// ✅✅✅ IMPORTANT ✅✅✅
// Export the CLASS, NOT an instance!
module.exports = YeahPayService;