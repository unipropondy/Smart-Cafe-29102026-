const { getReadOnlyPool, sql } = require('../config/database');

// In-memory fallback cache
const memorySessions = {};

async function getChatHistory(sessionId, limit = 5) {
  try {
    const pool = await getReadOnlyPool();
    const result = await pool.request()
      .input('SessionID', sql.UniqueIdentifier, sessionId)
      .input('Limit', sql.Int, limit)
      .query(`
        SELECT TOP (@Limit) Sender, ContentText, StructuredPayload, Timestamp 
        FROM AIChatMessages 
        WHERE SessionID = @SessionID 
        ORDER BY MessageID DESC
      `);
    
    // Return in chronological order
    return result.recordset.reverse();
  } catch (error) {
    console.warn("⚠️ Database chat history fetch failed, using memory fallback:", error.message);
    if (!memorySessions[sessionId]) {
      memorySessions[sessionId] = [];
    }
    return memorySessions[sessionId].slice(-limit);
  }
}

async function saveMessage(sessionId, sender, contentText, structuredPayload = null, sqlExecuted = null, responseTimeMs = null, orgId = 1, storeId = 1, userId = 1) {
  try {
    const pool = await getReadOnlyPool();
    
    // Ensure session exists
    await pool.request()
      .input('SessionID', sql.UniqueIdentifier, sessionId)
      .input('OrgID', sql.Int, orgId)
      .input('StoreID', sql.Int, storeId)
      .input('UserID', sql.Int, userId)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM AIChatSessions WHERE SessionID = @SessionID)
        BEGIN
          INSERT INTO AIChatSessions (SessionID, OrgID, StoreID, UserID, Title)
          VALUES (@SessionID, @OrgID, @StoreID, @UserID, 'AI Chat Session')
        END
        ELSE
        BEGIN
          UPDATE AIChatSessions SET LastActivityAt = GETDATE() WHERE SessionID = @SessionID
        END
      `);

    // Insert message
    await pool.request()
      .input('SessionID', sql.UniqueIdentifier, sessionId)
      .input('Sender', sql.NVarChar, sender)
      .input('ContentText', sql.NVarChar, contentText)
      .input('StructuredPayload', sql.NVarChar, structuredPayload ? JSON.stringify(structuredPayload) : null)
      .input('SQLExecuted', sql.NVarChar, sqlExecuted)
      .input('ResponseTimeMs', sql.Int, responseTimeMs)
      .query(`
        INSERT INTO AIChatMessages (SessionID, Sender, ContentText, StructuredPayload, SQLExecuted, ResponseTimeMs)
        VALUES (@SessionID, @Sender, @ContentText, @StructuredPayload, @SQLExecuted, @ResponseTimeMs)
      `);
  } catch (error) {
    console.warn("⚠️ Database chat save message failed, saving to memory fallback:", error.message);
    if (!memorySessions[sessionId]) {
      memorySessions[sessionId] = [];
    }
    memorySessions[sessionId].push({
      Sender: sender,
      ContentText: contentText,
      StructuredPayload: structuredPayload,
      Timestamp: new Date()
    });
  }
}

module.exports = {
  getChatHistory,
  saveMessage
};
