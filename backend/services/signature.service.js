// DEMO_2026_PONDY/backend/services/signature.service.js

const crypto = require('crypto');

class SignatureService {
    // Sort JSON keys alphabetically (deep)
    sortObjectKeys(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(item => this.sortObjectKeys(item));
        
        const sortedObj = {};
        Object.keys(obj).sort().forEach(key => {
            if (obj[key] !== null && obj[key] !== '' && obj[key] !== undefined) {
                sortedObj[key] = this.sortObjectKeys(obj[key]);
            }
        });
        return sortedObj;
    }

    // Remove empty/null/undefined values
    removeEmptyValues(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(item => this.removeEmptyValues(item));
        
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== '' && value !== undefined) {
                cleaned[key] = this.removeEmptyValues(value);
            }
        }
        return cleaned;
    }

    // Generate SHA256 signature
    generateSignature(data, salt) {
        // Remove empty values
        const cleaned = this.removeEmptyValues(data);
        // Sort keys alphabetically
        const sorted = this.sortObjectKeys(cleaned);
        // Convert to JSON string
        const jsonString = JSON.stringify(sorted);
        // Add salt and compute SHA256
        const stringToSign = jsonString + salt;
        const signature = crypto
            .createHash('sha256')
            .update(stringToSign, 'utf8')
            .digest('hex');
        
        console.log('[Signature] String to sign:', stringToSign);
        console.log('[Signature] Generated:', signature);
        
        return signature;
    }

    // Verify response signature
    verifySignature(data, signature, salt) {
        const computedSignature = this.generateSignature(data, salt);
        return computedSignature === signature;
    }
}

module.exports = new SignatureService();