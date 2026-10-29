// DEMO_2026_PONDY/backend/services/encryption.service.js

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class EncryptionService {
    // Generate random AES key (128 bits) and IV
    generateAESKeyAndIV() {
        const key = crypto.randomBytes(16);
        const iv = crypto.randomBytes(16);
        return {
            key: key.toString('hex'),
            iv: iv.toString('hex'),
        };
    }

    // RSA encrypt using Node.js built-in crypto with PEM file
    rsaEncryptAESKey(aesKeyHex, serverPublicKeyPem) {
        try {
            console.log('[Encryption] RSA Encrypting AES key...');
            
            const encrypted = crypto.publicEncrypt(
                {
                    key: serverPublicKeyPem,
                    padding: crypto.constants.RSA_PKCS1_PADDING
                },
                Buffer.from(aesKeyHex, 'hex')
            );
            
            console.log('[Encryption] RSA Encrypt success');
            return encrypted.toString('hex');
        } catch (error) {
            console.error('[Encryption] RSA encryption error:', error);
            throw error;
        }
    }

    // RSA decrypt using client private key
    rsaDecrypt(encryptedHex, clientPrivateKeyPem) {
        try {
            console.log('[Encryption] RSA Decrypting...');
            
            const decrypted = crypto.privateDecrypt(
                {
                    key: clientPrivateKeyPem,
                    padding: crypto.constants.RSA_PKCS1_PADDING
                },
                Buffer.from(encryptedHex, 'hex')
            );
            
            console.log('[Encryption] RSA Decrypt success');
            return decrypted.toString('hex');
        } catch (error) {
            console.error('[Encryption] RSA decryption error:', error);
            throw error;
        }
    }

    // AES encrypt
    aesEncrypt(data, keyHex, ivHex) {
        const key = Buffer.from(keyHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        
        const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    // AES decrypt
    aesDecrypt(encryptedHex, keyHex, ivHex) {
        const key = Buffer.from(keyHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    }
}

module.exports = new EncryptionService();