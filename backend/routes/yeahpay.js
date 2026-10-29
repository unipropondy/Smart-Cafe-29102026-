// DEMO_2026_PONDY/backend/routes/yeahpay.js

const express = require('express');
const router = express.Router();
const YeahPayService = require('../services/yeahpay.service');  // ✅ Class

const FIXED_APP_ID = process.env.APP_ID || 'bin38m42efz4ta6f';

// ✅ CREATE INSTANCE with config
const yeahpayService = new YeahPayService();

function broadcastTerminalStatus(io, tableId, amount, isCard, result, isSplit, splitRowId) {
    if (!io) return;
    const targetTableId = tableId || "COUNTER";
    
    let status = "failed";
    let message = "";
    const responseCode = result.code;
    
    if (result.success || responseCode === 0) {
        status = "success";
        message = `✅ $${parseFloat(amount).toFixed(2)} paid successfully`;
    } else if (responseCode === -1027) {
        status = "cancelled";
        message = `❌ Transaction cancelled on terminal`;
    } else if (responseCode === -1028 || responseCode === -1008) {
        status = "failed";
        message = `⏰ Transaction timeout`;
    } else {
        status = "failed";
        message = `❌ ${result.msg || result.error || 'Payment declined'}`;
    }

    console.log(`🔌 [Server] Broadcasting terminal sync for Table ${targetTableId} → Status: ${status}`);
    io.emit("terminal_payment_sync", {
        tableId: targetTableId,
        session: {
            tableId: targetTableId,
            status,
            message,
            method: isCard ? 'YEAHPAY CARD' : 'YEAHPAY PAYNOW',
            total: parseFloat(amount) || 0,
            isSplit: !!isSplit,
            splitRowId
        }
    });
}

// YeahPay PayNow Payment
router.post('/paynow-payment', async (req, res) => {
    try {
        const { amount, deviceSn, salt, tableId, isSplit, splitRowId } = req.body;
        
        console.log('📱 YeahPay PayNow:', { amount, deviceSn, salt: salt ? 'Yes' : 'No', tableId });
        
        if (!deviceSn) {
            return res.status(400).json({ 
                success: false, 
                code: -1, 
                msg: 'DeviceSN is required' 
            });
        }
        
        // ✅ Call method on INSTANCE
        const result = await yeahpayService.processPayNowPayment({
            amount, 
            deviceSn, 
            salt, 
            appId: FIXED_APP_ID
        });
        
        console.log('📤 YeahPay Result:', result);
        
        // Broadcast the status via socket
        broadcastTerminalStatus(req.io, tableId, amount, false, result, isSplit, splitRowId);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ YeahPay Error:', error);
        
        const failResult = { success: false, code: -1, msg: error.message };
        broadcastTerminalStatus(req.io, req.body.tableId, req.body.amount, false, failResult, req.body.isSplit, req.body.splitRowId);
        
        res.status(500).json(failResult);
    }
});

// YeahPay Card Payment
router.post('/card-payment', async (req, res) => {
    try {
        const { amount, deviceSn, salt, tableId, isSplit, splitRowId } = req.body;
        
        console.log('💳 YeahPay Card:', { amount, deviceSn, tableId });
        
        if (!deviceSn) {
            return res.status(400).json({ 
                success: false, 
                code: -1, 
                msg: 'DeviceSN is required' 
            });
        }
        
        // ✅ Call method on INSTANCE
        const result = await yeahpayService.processCardPayment({
            amount, 
            deviceSn, 
            salt, 
            appId: FIXED_APP_ID
        });
        
        // Broadcast the status via socket
        broadcastTerminalStatus(req.io, tableId, amount, true, result, isSplit, splitRowId);
        
        res.json(result);
    } catch (error) {
        const failResult = { success: false, code: -1, msg: error.message };
        broadcastTerminalStatus(req.io, req.body.tableId, req.body.amount, true, failResult, req.body.isSplit, req.body.splitRowId);
        
        res.status(500).json(failResult);
    }
});

module.exports = router;
