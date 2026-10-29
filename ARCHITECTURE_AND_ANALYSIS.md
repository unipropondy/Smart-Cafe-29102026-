# UCS PONDY - Restaurant POS System: Architecture & Analysis

## 📋 EXECUTIVE SUMMARY
This is a **restaurant Point-of-Sale (POS) system** with a React Native frontend, Node.js backend, and MSSQL database. It handles orders, payments, kitchen display, inventory, and reporting. The architecture is **functional but has critical security issues and technical debt**.

---

## 🏗️ ARCHITECTURE OVERVIEW

### **Technology Stack**
```
Frontend:   React Native (Expo) + TypeScript + Zustand (state management)
Backend:    Node.js + Express.js + Socket.io (real-time)
Database:   Microsoft SQL Server (MSSQL)
Deployment: Unknown (assumed self-hosted)
```

### **High-Level Architecture Diagram**
```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER (Frontend)                   │
│              React Native/Expo Mobile App (TypeScript)      │
│  - Authentication (login)                                    │
│  - POS Dashboard (menu, cart, payment)                       │
│  - Kitchen Display System (KDS)                              │
│  - Reporting & Analytics                                     │
│  - Member Management                                         │
│  - Attendance Tracking                                       │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP + WebSocket (Socket.io)
                     │
┌────────────────────▼────────────────────────────────────────┐
│                  API LAYER (Backend)                         │
│            Express.js Server (Port 3000)                     │
├────────────────────────────────────────────────────────────┤
│ Routes:                                                      │
│  - /api/auth          (Authentication & Login)              │
│  - /api/orders        (Order Management)                     │
│  - /api/menu          (Menu, Dishes, Categories)            │
│  - /api/sales         (Settlements & Reports)               │
│  - /api/tables        (Table Management)                     │
│  - /api/members       (Customer Profiles)                    │
│  - /api/attendance    (Employee Attendance)                  │
│  - /api/admin         (Admin Functions)                      │
│  - /api/servers       (Waiter Management)                    │
│  - /api/settings      (System Settings)                      │
│  - /api/export        (Data Export)                          │
└────────────────────┬────────────────────────────────────────┘
                     │ ODBC/TCP (1433)
                     │
┌────────────────────▼────────────────────────────────────────┐
│                   DATA LAYER (Database)                      │
│         Microsoft SQL Server (MSSQL)                         │
├────────────────────────────────────────────────────────────┤
│ Key Tables:                                                  │
│  - UserMaster          (Users & Roles)                       │
│  - RestaurantOrderCur  (Active Orders)                       │
│  - DishMaster          (Menu Items)                          │
│  - SettlementHeader    (Payments/Invoices)                   │
│  - TableMaster         (Seating)                             │
│  - CategoryMaster      (Menu Categories)                     │
│  - MemberMaster        (Customers)                           │
│  - AttendanceMaster    (Employee Hours)                      │
└────────────────────────────────────────────────────────────┘
```

### **Data Flow: Order Lifecycle**
```
1. Customer Orders:
   Client → POST /api/orders/add
   → Create RestaurantOrderCur entry
   → Socket.io broadcast "new_order"
   → KDS receives order in real-time

2. Kitchen Processing:
   KDS marks items as "SENT" → "READY"
   → Socket.io broadcast "order_status_update"
   → Client updates order status

3. Payment Settlement:
   Client → POST /api/orders/settle
   → Insert SettlementHeader + SettlementItemDetail
   → Calculate GST, discounts, service charge
   → Update TableMaster status to available

4. Reporting:
   Client → GET /api/sales/report
   → Query aggregated settlement data
   → Generate daily/weekly/monthly reports
```

### **Key Components**

#### **Frontend (React Native/Expo)**
- **Authentication**: Login with JWT tokens (24h expiry)
- **Stores** (Zustand): authStore, cartStore, menuStore, activeOrdersStore, tableStatusStore
- **UI Components**: CartSidebar, PaymentModal, CancelOrderModal, BillPDFGenerator
- **KDS Screen**: Real-time order updates via Socket.io
- **Role-Based Access**: Permissions checked for ADMIN, WAITER, CASHIER, KDS roles

#### **Backend (Express.js)**
- **Middleware**: CORS, compression, body-parser, dbCheck (connection validation)
- **Socket.io Server**: Broadcasts order events in real-time
- **Database Pool**: Connection pooling with mssql package (max 100 connections)
- **Initialization**: Auto-creates missing tables on startup (config/init.js)

#### **Database (MSSQL)**
- **Schema**: ~30+ tables (dishes, categories, orders, payments, users, etc.)
- **Auto-migration**: Tables created on first run if missing
- **Key IDs**: GUIDs for most entities, numeric IDs for some legacy tables
- **Timezone Handling**: Converts UTC+7.8 (server) to UTC+5.5 (IST) for date filtering

---

## 🐛 CRITICAL BUGS & ISSUES

### **🔴 SEVERITY: CRITICAL**

#### **1. Hardcoded Credentials in Code**
**Location**: `backend/routes/auth.js:21-32`
```javascript
if (userName.toUpperCase() === "KDS" && password === "as786") {
  // HARDCODED LOGIN - MAJOR SECURITY RISK
  const kdsToken = jwt.sign({ userId: "999", role: "KDS" }, JWT_SECRET, { expiresIn: "24h" });
  return res.json({ success: true, token: kdsToken, ... });
}
```
**Impact**: 
- Anyone can login as KDS (Kitchen Display System) with password "as786"
- Grants full kitchen access without database validation
- Credentials visible in source code (git, deployments)

**Risk**: Unauthorized access to order system, order manipulation, data theft

---

#### **2. Weak Password Storage**
**Location**: `backend/routes/auth.js:87-104`
```javascript
const candidates = [dbPassword, parts[0]].filter(c => c.length > 0);
for (const cand of candidates) {
  if (cand === password) { isValid = true; break; }
  try {
    const decoded = Buffer.from(cand, "base64").toString("utf-8").trim();
    if (decoded === password) { isValid = true; break; }
  } catch (e) {}
}
```
**Issues**:
- Passwords stored in **plaintext** or **base64** (not hashed!)
- No salt, no bcrypt, no argon2
- Base64 is encoding, not encryption (easily reversible)
- Split logic on "-" suggests legacy data migration issues

**Impact**: If database is compromised, all passwords exposed instantly

---

#### **3. Insecure JWT Secret**
**Location**: `backend/routes/auth.js:5`
```javascript
const JWT_SECRET = process.env.JWT_SECRET || "pos_secure_secret_2026";
```
**Issues**:
- Default secret is hardcoded and weak ("pos_secure_secret_2026")
- Easy to guess
- 24-hour token expiry (long duration)
- No refresh token mechanism

**Impact**: Tokens can be forged, long session windows increase attack surface

---

#### **4. No SQL Injection Protection in Some Queries**
**Location**: `backend/routes/orders.js:48-52`
```javascript
const headerCheck = await transaction.request()
  .input("orderNo", sql.NVarChar(50), cleanOrderNo)
  .input("tableNo", sql.VarChar(20), actualTableNo)
  .query(`
    SELECT TOP 1 OrderId FROM RestaurantOrderCur 
    WHERE OrderNumber = @orderNo 
    OR (Tableno = @tableNo AND isOrderClosed = 0) 
    ORDER BY CreatedOn DESC
  `);
```
**Status**: ✅ Actually SAFE (using parameterized queries)

**However**, Location: `backend/routes/menu.js`
```javascript
router.get("/dishes/group/:DishGroupId", async (req, res) => {
  const result = await pool.request()
    .input("DishGroupId", req.params.DishGroupId)  // ✅ Parameterized
    .query(`SELECT ... WHERE d.DishGroupId = @DishGroupId`);
```
**Status**: ✅ Parameterized (safe)

**But CORS is too permissive**:
```javascript
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }  // ⚠️ Open to all origins
});
```

---

#### **5. Missing Authentication Middleware**
**Location**: `backend/server.js:86-100`
```javascript
app.use("/api/auth", authRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/menu", menuRoutes);
// ... ALL routes have NO JWT verification!
```
**Issue**: 
- No `@authenticate` middleware on protected routes
- Any unauthenticated user can call:
  - `GET /api/menu/dishes/all` → Leaks menu items
  - `GET /api/members/` → Leaks customer data
  - `GET /api/sales/report` → Leaks financial data
  - `POST /api/orders/add` → Creates fake orders

**Impact**: Complete API exposure; anyone can read/write all data

---

#### **6. Credentials Logged to Console**
**Location**: `backend/routes/auth.js:49`
```javascript
console.log(`[DEBUG LOGIN] User found:`, JSON.stringify(user, null, 2));
```
**Issue**: 
- Logs contain user data, password hashes, user IDs
- Visible in console, logs files, cloud logging (if deployed)
- Accumulates over time in production logs

**Impact**: Sensitive data exposure through log files

---

### **🟠 SEVERITY: HIGH**

#### **7. Race Condition in Order ID Generation**
**Location**: `backend/routes/orders.js:29-71`
```javascript
// Get or generate order ID for a table
const headerCheck = await transaction.request()
  .input("orderNo", sql.NVarChar(50), cleanOrderNo)
  .input("tableNo", sql.VarChar(20), actualTableNo)
  .query(`SELECT TOP 1 OrderId FROM RestaurantOrderCur ...`);

if (headerCheck.recordset.length > 0) {
  orderGuid = headerCheck.recordset[0].OrderId;  // Reuse existing
} else {
  orderGuid = require("crypto").randomUUID();    // Generate new
  // INSERT into database
}
```
**Issue**:
- Two simultaneous requests can both execute the INSERT
- Creates duplicate orders with same OrderId
- No transaction isolation / unique constraint on (tableNo, date)

**Impact**: Duplicate orders, inventory miscount, settlement errors

---

#### **8. No Input Validation on Amount Fields**
**Location**: `backend/routes/members.js:26`
```javascript
.input("CreditLimit", sql.Decimal(18, 2), parseFloat(creditLimit) || 0)
.input("CurrentBalance", sql.Decimal(18, 2), parseFloat(currentBalance) || 0)
```
**Issue**:
- No validation for negative amounts
- No validation for maximum limits
- `parseFloat()` silently fails on non-numeric input
- No rate limiting on member creation

**Impact**: 
- Negative credit limits
- Invalid data in database
- Brute-force attacks (create millions of members)

---

#### **9. No Request Rate Limiting**
**Location**: `backend/server.js`
**Issue**: No rate limiting middleware (express-rate-limit)
- Anyone can spam `/api/auth/login` (brute force)
- DDoS attacks by flooding `/api/orders/add`
- Resource exhaustion

---

#### **10. CORS Too Permissive**
**Location**: `backend/server.js:36-40`
```javascript
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"],
}));
```
**Issue**:
- `origin: "*"` allows requests from ANY domain
- No whitelist of allowed clients
- CSRF attacks possible

---

#### **11. Timezone Calculation is Fragile**
**Location**: `backend/routes/sales.js:21`
```javascript
const getReportDateWhereSql = (filter = "daily", ..., date = null) => {
  // Offset = 7.8 - 5.5 = 2.3 hours = 138 minutes
  const targetDate = date ? `'${date}'` : 'DATEADD(MINUTE, -138, GETDATE())';
```
**Issue**:
- Hardcoded timezone offset (Server UTC+7.8 → IST UTC+5.5)
- Assumes server is always UTC+7.8
- Breaks if server timezone changes or server moves
- No handling of daylight saving time

**Impact**: Reports show wrong dates/ranges

---

#### **12. No Data Validation on Order Items**
**Location**: `backend/routes/orders.js:120+`
```javascript
for (const item of items) {
  const cleanProdId = String(item.id || item.ProductId || DEFAULT_GUID).replace(/^\{|\}$/g, "").trim();
  let finalProdId = cleanProdId;
  if (finalProdId.length < 10) finalProdId = DEFAULT_GUID;  // Fallback to NULL GUID!
  
  const unitPrice = item.price || item.Cost || 0;  // What if price is negative?
  const dishName = (item.name || item.ProductName || 'Dish').substring(0, 200);
```
**Issues**:
- Invalid product IDs default to `00000000-0000-0000-0000-000000000000`
- Negative prices accepted
- Price from client (can be spoofed)
- No verification that product exists

---

### **🟡 SEVERITY: MEDIUM**

#### **13. Frontend Stores Have No Persistence**
**Location**: `frontend/stores/authStore.ts`, etc.
**Issue**: 
- Zustand stores in-memory only
- User gets logged out on app refresh
- Cart data lost on crash
- Token not persisted to secure storage

**Expected**: Use AsyncStorage for persistence

---

#### **14. No Error Boundary in Frontend**
**Issue**: React Native app will crash on unhandled errors
- No error logging to server
- Users see white screen
- No recovery mechanism

---

#### **15. Socket.io Events Have No Validation**
**Location**: `backend/server.js:47-60`
```javascript
io.on("connection", (socket) => {
  socket.on("new_order", (data) => {
    console.log("📦 [Server] New order event received:", data.orderId);
    socket.broadcast.emit("new_order", data);  // Echoes data as-is, no validation!
  });
});
```
**Issue**:
- No schema validation
- No authentication check on socket events
- Any client can broadcast fake orders to all KDS screens
- No rate limiting

---

#### **16. Missing Indexes on High-Query Tables**
**Location**: Database (not configured anywhere)
**Issue**:
- `RestaurantOrderCur` likely has millions of rows
- Queries like `WHERE OrderNumber = @orderNo OR Tableno = @tableNo` without indexes
- `SettlementItemDetail` joined in reports without indexes

**Impact**: Slow queries, timeout errors during peak hours

---

#### **17. File Upload No Validation**
**Location**: `backend/routes/upload.js` (not shown, but exists)
**Issue** (inferred):
- Likely accepts any file type
- No size limit validation
- Potential for path traversal attacks
- Could fill disk with large files

---

#### **18. Default GUID Used as Fallback**
**Location**: `backend/routes/orders.js:30, 35, 142`
```javascript
let finalUserId = userId;
if (!finalUserId || finalUserId.length < 10) finalUserId = DEFAULT_GUID;  // Fallback!
```
**Issue**:
- Invalid data silently accepted
- Order attributed to NULL user (00000000...)
- Breaks audit trail

---

### **🔵 SEVERITY: LOW**

#### **19. Inconsistent Error Messages**
Different routes return errors in different formats:
- `{ error: "message" }`
- `{ success: false, message: "message" }`
- Plain text: `res.status(500).send(err.message)`

**Impact**: Client code needs multiple error handlers

---

#### **20. No API Versioning**
All endpoints are `/api/v1/...` (actually no versioning)
- Backwards compatibility issues
- Can't deprecate endpoints

---

#### **21. Unused / Duplicate Route Files**
- `backend/routes/sales.js_temp` (leftover)
- Multiple inspection scripts in backend/scratch/ (clutter)

---

#### **22. No Database Backup Strategy**
- No mention of backups
- No disaster recovery plan
- Single point of failure

---

#### **23. No Monitoring/Alerting**
- No health checks
- No uptime monitoring
- No performance metrics
- No logging aggregation

---

## ✅ IMPROVEMENTS (Non-Critical)

### **Architecture Improvements**
1. **Move to Microservices**: Separate auth, orders, menu, reporting into separate services
2. **Message Queue**: Add RabbitMQ/Kafka for async order processing instead of sync DB calls
3. **Caching Layer**: Redis for menu items, user data, session storage
4. **API Gateway**: Add Kong/Traefik for rate limiting, load balancing, monitoring

### **Security Improvements** (URGENT)
1. **Password Hashing**: Replace plaintext/base64 with bcrypt (salt + hash)
   ```javascript
   const bcrypt = require('bcrypt');
   const hash = await bcrypt.hash(password, 10);
   const isValid = await bcrypt.compare(password, hash);
   ```

2. **Add Authentication Middleware**:
   ```javascript
   function authenticate(req, res, next) {
     const token = req.headers.authorization?.split(' ')[1];
     if (!token) return res.status(401).json({ error: 'No token' });
     try {
       req.user = jwt.verify(token, process.env.JWT_SECRET);
       next();
     } catch (err) {
       res.status(403).json({ error: 'Invalid token' });
     }
   }
   // Use on protected routes:
   app.use("/api/orders", authenticate);
   app.use("/api/menu", authenticate);
   ```

3. **Remove Hardcoded Credentials**: Move KDS login to database
   ```javascript
   // Before: hardcoded "KDS" / "as786"
   // After: Query UserMaster for KDS user
   const kdsUser = await pool.request()
     .input("UserName", "KDS")
     .query("SELECT * FROM UserMaster WHERE UserName = @UserName");
   ```

4. **Use Environment Variables**:
   ```javascript
   require('dotenv').config();
   const JWT_SECRET = process.env.JWT_SECRET;  // Must be set, no fallback
   if (!JWT_SECRET) throw new Error('JWT_SECRET not set!');
   ```

5. **Validate All Inputs**:
   ```javascript
   const { body, validationResult } = require('express-validator');
   
   router.post('/members/add',
     body('name').notEmpty().isLength({ min: 1, max: 255 }),
     body('phone').optional().isPhoneNumber(),
     body('creditLimit').isFloat({ min: 0, max: 999999 }),
     async (req, res) => {
       const errors = validationResult(req);
       if (!errors.isEmpty()) return res.status(400).json({ errors });
       // Process validated data
     }
   );
   ```

6. **Add Rate Limiting**:
   ```javascript
   const rateLimit = require('express-rate-limit');
   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000,  // 15 minutes
     max: 100  // limit each IP to 100 requests per windowMs
   });
   app.use('/api/auth/login', limiter);  // Prevent brute force
   ```

7. **Remove Debug Logging**:
   ```javascript
   // Remove: console.log(`[DEBUG LOGIN] Attempting login for UserName: "${userName}"`);
   // Replace with: logger.debug('Login attempt', { username: userName });
   ```

8. **Fix CORS**:
   ```javascript
   app.use(cors({
     origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
     methods: ['GET', 'POST', 'PUT', 'DELETE'],
     credentials: true,
     maxAge: 3600
   }));
   ```

### **Database Improvements**
1. **Add Indexes** (critical for performance):
   ```sql
   CREATE INDEX idx_RestaurantOrderCur_OrderNumber ON RestaurantOrderCur(OrderNumber);
   CREATE INDEX idx_RestaurantOrderCur_TableNo_Date ON RestaurantOrderCur(Tableno, CreatedOn);
   CREATE INDEX idx_SettlementHeader_Date ON SettlementHeader(LastSettlementDate);
   ```

2. **Add Unique Constraints**:
   ```sql
   ALTER TABLE RestaurantOrderCur ADD CONSTRAINT uk_OrderNumber UNIQUE (OrderNumber);
   ```

3. **Fix Timezone Handling**:
   ```sql
   -- Store all times in UTC, convert in application
   ALTER TABLE RestaurantOrderCur ADD OrderDateTimeUTC DATETIME2 DEFAULT GETUTCDATE();
   -- In app: Convert UTC to IST when needed
   ```

4. **Add Audit Trail**:
   ```sql
   ALTER TABLE RestaurantOrderCur ADD ModifiedBy UNIQUEIDENTIFIER, ModifiedOn DATETIME;
   CREATE TABLE AuditLog (
     AuditId BIGINT PRIMARY KEY,
     TableName NVARCHAR(100),
     OperationType NVARCHAR(10),  -- INSERT, UPDATE, DELETE
     RecordId UNIQUEIDENTIFIER,
     ChangedValues NVARCHAR(MAX),
     ChangedBy UNIQUEIDENTIFIER,
     ChangedOn DATETIME
   );
   ```

### **Frontend Improvements**
1. **Persist Authentication**:
   ```typescript
   import * as SecureStore from 'expo-secure-store';
   
   const authStore = create((set) => ({
     token: null,
     loadToken: async () => {
       const token = await SecureStore.getItemAsync('auth_token');
       set({ token });
     },
     setToken: async (token) => {
       await SecureStore.setItemAsync('auth_token', token);
       set({ token });
     }
   }));
   ```

2. **Add Error Boundary**:
   ```typescript
   export class ErrorBoundary extends React.Component {
     componentDidCatch(error, info) {
       // Log to server
       fetch('/api/logs/error', {
         method: 'POST',
         body: JSON.stringify({ error, info })
       });
     }
     render() {
       return <Text>App Error - Please restart</Text>;
     }
   }
   ```

3. **Validate Socket Events**:
   ```typescript
   socket.on('new_order', (data) => {
     if (!data.orderId || !data.items?.length) return;  // Ignore invalid
     // Process order
   });
   ```

### **Operations/DevOps**
1. **Add Health Checks**:
   ```javascript
   app.get('/health', async (req, res) => {
     const pool = getPool();
     if (!pool) return res.status(503).json({ status: 'unhealthy' });
     res.json({ status: 'healthy', timestamp: new Date() });
   });
   ```

2. **Structured Logging** (instead of console.log):
   ```javascript
   const winston = require('winston');
   const logger = winston.createLogger({
     level: 'info',
     format: winston.format.json(),
     transports: [
       new winston.transports.File({ filename: 'error.log', level: 'error' }),
       new winston.transports.File({ filename: 'combined.log' })
     ]
   });
   ```

3. **Database Backups**:
   ```sql
   BACKUP DATABASE POS_DB TO DISK = '\\backup\pos_backup_2026-05-11.bak';
   ```

4. **Monitoring** (add Prometheus + Grafana):
   - API response times
   - Database query times
   - Error rates
   - Socket.io connection count

---

## 📊 QUICK SCORECARD

| Category | Rating | Status |
|----------|--------|--------|
| **Security** | 🔴 2/10 | CRITICAL - Fix immediately |
| **Performance** | 🟡 5/10 | No caching, no indexes |
| **Scalability** | 🟡 4/10 | Single DB, no queue system |
| **Code Quality** | 🟡 5/10 | No linting, no tests, duplicates |
| **Documentation** | 🔴 1/10 | None exists |
| **Monitoring** | 🔴 1/10 | No logging, no metrics |
| **Error Handling** | 🟡 4/10 | Inconsistent, missing validation |
| **Database** | 🟡 5/10 | No indexes, no constraints |
| **Overall** | 🔴 3/10 | **DO NOT RUN IN PRODUCTION** |

---

## 🚀 RECOMMENDED ROADMAP

### **Phase 1: Security (URGENT - 2 weeks)**
- [ ] Remove hardcoded credentials
- [ ] Implement password hashing (bcrypt)
- [ ] Add JWT validation on all protected routes
- [ ] Use environment variables for secrets
- [ ] Add input validation on all endpoints
- [ ] Remove debug logging
- [ ] Restrict CORS

### **Phase 2: Stability (1 month)**
- [ ] Add database indexes
- [ ] Fix timezone handling
- [ ] Add transaction isolation for order creation
- [ ] Implement error boundary in frontend
- [ ] Add health checks
- [ ] Structured logging

### **Phase 3: Scalability (2-3 months)**
- [ ] Add Redis caching
- [ ] Implement message queue (RabbitMQ)
- [ ] Add API versioning
- [ ] Refactor large files (routes are 500+ lines)
- [ ] Add rate limiting

### **Phase 4: Operations (Ongoing)**
- [ ] Set up monitoring (Prometheus + Grafana)
- [ ] Automated backups
- [ ] CI/CD pipeline
- [ ] Load testing
- [ ] Documentation

---

## 🔗 Key Files for Review

**Backend Critical**:
- `backend/routes/auth.js` - **URGENT: Fix password hashing & hardcoded KDS**
- `backend/server.js` - **URGENT: Add auth middleware**
- `backend/routes/orders.js` - Fix race conditions, validate items
- `backend/config/db.js` - Good pool config, consider max timeout
- `backend/config/init.js` - Auto-migration is clever but not idempotent

**Frontend**:
- `frontend/stores/authStore.ts` - Add secure token persistence
- `frontend/app/(tabs)/_layout.tsx` - Good KDS routing guard

**Database**:
- Add indexes to `RestaurantOrderCur`, `SettlementHeader`, `SettlementItemDetail`
- Add unique constraints
- Consider audit logging

---

## 🎯 SUMMARY

**Strengths**:
✅ Architecture is clean and modular  
✅ Uses Socket.io for real-time updates  
✅ Handles complex order/settlement logic  
✅ Auto-migration of schema  
✅ Multiple role-based access control  

**Critical Issues**:
❌ Hardcoded credentials ("KDS"/"as786")  
❌ Plaintext/base64 password storage  
❌ No authentication middleware on protected routes  
❌ Weak JWT secret with fallback  
❌ CORS too permissive  
❌ SQL queries vulnerable to race conditions  

**Status**: **DO NOT DEPLOY TO PRODUCTION** until security issues are fixed.

