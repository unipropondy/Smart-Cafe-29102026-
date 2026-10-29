const processedRequests = new Map(); // requestId -> { status, timestamp, response: { status, headers, body } }

// Cleanup interval: run every 5 minutes to clear entries older than 5 minutes (fallback safety)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of processedRequests.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      processedRequests.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = function idempotencyMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || req.headers['X-Request-ID'];
  
  // Only apply to modifying requests (POST, PUT, DELETE) that specify a request ID
  if (!requestId || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (processedRequests.has(requestId)) {
    const record = processedRequests.get(requestId);
    console.log(`[Idempotency] Duplicate request detected for ID: ${requestId}. Method: ${req.method}, URL: ${req.originalUrl}. Status: ${record.status}`);
    
    if (record.status === 'processing') {
      // If it is still being processed by the server, return a 409 Conflict to avoid overlapping execution
      return res.status(409).json({ error: "Request is already processing. Please try again." });
    }
    
    // Serve the cached response directly
    res.status(record.response.status);
    Object.entries(record.response.headers).forEach(([key, val]) => {
      res.setHeader(key, val);
    });
    return res.send(record.response.body);
  }

  // Register request as processing to lock it
  processedRequests.set(requestId, { 
    status: 'processing', 
    timestamp: Date.now() 
  });

  // Intercept the send method to capture response once it resolves
  const originalSend = res.send;
  res.send = function (body) {
    // Save response details to cache
    processedRequests.set(requestId, {
      status: 'resolved',
      timestamp: Date.now(),
      response: {
        status: res.statusCode,
        headers: res.getHeaders(),
        body: body
      }
    });

    // Remove from memory cache after 5 minutes
    setTimeout(() => {
      processedRequests.delete(requestId);
    }, 5 * 60 * 1000);

    return originalSend.apply(res, arguments);
  };

  next();
};
