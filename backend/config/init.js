const sql = require("mssql");

async function initDB(pool) {
  if (!pool) return;
  console.log("🔄 Running schema check and initialization...");

  const runQuery = async (name, query) => {
    try {
      await pool.request().query(query);
      console.log(`✅ ${name} OK`);
    } catch (err) {
      console.error(`❌ ${name} FAILED:`, err.message);
      // We don't throw here to allow other steps to try, but in production you might want to
    }
  };

  try {
    // 1. SettlementItemDetail
    await runQuery("Create SettlementItemDetail", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[SettlementItemDetail](
              [ID] [int] IDENTITY(1,1) NOT NULL,
              [SettlementID] [uniqueidentifier] NULL,
              [DishId] [uniqueidentifier] NULL,
              [DishGroupId] [uniqueidentifier] NULL,
              [SubCategoryId] [uniqueidentifier] NULL,
              [CategoryId] [uniqueidentifier] NULL,
              [DishName] [nvarchar](255) NULL,
              [Qty] [decimal](18, 3) NULL,
              [Price] [decimal](18, 2) NULL,
              [OrderDateTime] [datetime] NULL
          ) ON [PRIMARY]
      END
    `);

    // 2. MemberMaster
    await runQuery("Create MemberMaster", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[MemberMaster](
              [MemberId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [Name] [nvarchar](255) NOT NULL,
              [Phone] [nvarchar](50) NULL,
              [Email] [nvarchar](255) NULL,
              [Address] [nvarchar](max) NULL,
              [IsActive] [bit] DEFAULT 1,
              [Balance] [decimal](18, 2) DEFAULT 0,
              [CreditLimit] [decimal](18, 2) DEFAULT 0,
              [CurrentBalance] [decimal](18, 2) DEFAULT 0,
              [CreatedOn] [datetime] DEFAULT GETDATE()
          )
      END
    `);

    // 2.1 MemberMaster extra columns (prepaid balance alert flag)
    await runQuery("MemberMaster - LowBalanceAlertSent", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'LowBalanceAlertSent') ALTER TABLE [dbo].[MemberMaster] ADD LowBalanceAlertSent BIT NOT NULL DEFAULT 0");
    await runQuery("MemberMaster - ModifiedBy", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'ModifiedBy') ALTER TABLE [dbo].[MemberMaster] ADD ModifiedBy UNIQUEIDENTIFIER NULL");
    await runQuery("MemberMaster - ModifiedDate", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'ModifiedDate') ALTER TABLE [dbo].[MemberMaster] ADD ModifiedDate DATETIME NULL");
    await runQuery("MemberMaster - CreatedBy", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'CreatedBy') ALTER TABLE [dbo].[MemberMaster] ADD CreatedBy UNIQUEIDENTIFIER NULL");
    await runQuery("MemberMaster - Promocode", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'Promocode') ALTER TABLE [dbo].[MemberMaster] ADD Promocode NVARCHAR(100) NULL");
    await runQuery("MemberMaster - Promoamount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'Promoamount') ALTER TABLE [dbo].[MemberMaster] ADD Promoamount DECIMAL(18,2) NULL");
    // AvailableCredit computed column — only add if it doesn't exist yet
    await runQuery("MemberMaster - AvailableCredit", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'AvailableCredit') ALTER TABLE [dbo].[MemberMaster] ADD AvailableCredit AS (CASE WHEN CreditLimit > 0 THEN (CreditLimit - CurrentBalance) ELSE CurrentBalance END)");

    // 🏆 REWARD POINTS: Add RewardCredit wallet column to MemberMaster
    await runQuery("MemberMaster - RewardCredit", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'RewardCredit') ALTER TABLE [dbo].[MemberMaster] ADD RewardCredit DECIMAL(18,4) NOT NULL DEFAULT 0");
    await runQuery("MemberMaster - Password", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'Password') ALTER TABLE [dbo].[MemberMaster] ADD Password NVARCHAR(255) NULL");
    await runQuery("MemberMaster - CreatedAt", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'CreatedAt') ALTER TABLE [dbo].[MemberMaster] ADD CreatedAt DATETIME NULL");

    // 🏆 REWARD POINTS: Drop and recreate AvailableCredit computed column to include RewardCredit
    // This updates the formula so AvailableCredit = credit capacity + reward wallet
    await runQuery("MemberMaster - AvailableCredit (Reward-aware)", `
      IF EXISTS (SELECT * FROM sys.computed_columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'AvailableCredit')
      BEGIN
        -- Only rebuild if RewardCredit column now exists (safe guard)
        IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'RewardCredit')
        BEGIN
          -- Check if the formula already includes RewardCredit (avoid repeated DROP/ADD)
          DECLARE @existingDef NVARCHAR(MAX);
          SELECT @existingDef = definition FROM sys.computed_columns
          WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'AvailableCredit';
          IF @existingDef NOT LIKE '%RewardCredit%'
          BEGIN
            ALTER TABLE [dbo].[MemberMaster] DROP COLUMN AvailableCredit;
            ALTER TABLE [dbo].[MemberMaster] ADD AvailableCredit AS (CASE WHEN CreditLimit > 0 THEN (CreditLimit - CurrentBalance) ELSE 0 END + ISNULL(RewardCredit, 0));
          END
        END
      END
    `);

    // 🏆 REWARD POINTS: Unique constraint on Phone (no duplicate member numbers)
    await runQuery("MemberMaster - UniquePhone", `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes 
        WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'UQ_MemberMaster_Phone'
      )
      BEGIN
        -- Only create if there are no existing duplicate phones
        IF NOT EXISTS (
          SELECT Phone, COUNT(*) FROM [dbo].[MemberMaster]
          WHERE Phone IS NOT NULL AND Phone <> ''
          GROUP BY Phone HAVING COUNT(*) > 1
        )
        BEGIN
          CREATE UNIQUE NONCLUSTERED INDEX UQ_MemberMaster_Phone
          ON [dbo].[MemberMaster](Phone)
          WHERE Phone IS NOT NULL AND Phone <> '';
        END
      END
    `);

    // 🏆 REWARD POINTS: RewardMaster — configures earn ratio
    await runQuery("Create RewardMaster", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RewardMaster]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[RewardMaster] (
          [Id]           INT IDENTITY(1,1) PRIMARY KEY,
          [SpendAmount]  DECIMAL(18,2) NOT NULL DEFAULT 100,
          [CreditAmount] DECIMAL(18,4) NOT NULL DEFAULT 1,
          [IsActive]     BIT NOT NULL DEFAULT 1,
          [Description]  NVARCHAR(255) NULL,
          [CreatedOn]    DATETIME DEFAULT GETDATE(),
          [ModifiedOn]   DATETIME NULL
        );
        -- Seed with default: every $100 spent earns $1 reward credit
        INSERT INTO [dbo].[RewardMaster] (SpendAmount, CreditAmount, IsActive, Description)
        VALUES (100, 1, 1, 'Default: $100 spent = $1 reward credit');
      END
    `);

    // 🏆 REWARD POINTS: RewardPointDetails — per-transaction audit log
    await runQuery("Create RewardPointDetails", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[RewardPointDetails] (
          [Id]           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
          [MemberId]     UNIQUEIDENTIFIER NOT NULL,
          [SettlementId] UNIQUEIDENTIFIER NULL,
          [BillNo]       NVARCHAR(50) NULL,
          [BillAmount]   DECIMAL(18,2) NOT NULL DEFAULT 0,
          [PointsEarned] DECIMAL(18,4) NOT NULL DEFAULT 0,
          [PointsUsed]   DECIMAL(18,4) NOT NULL DEFAULT 0,
          [TransType]    NVARCHAR(20) NOT NULL DEFAULT 'EARN',
          [PayMode]      NVARCHAR(50) NULL,
          [Remarks]      NVARCHAR(255) NULL,
          [CreatedOn]    DATETIME DEFAULT GETDATE()
        );
        CREATE NONCLUSTERED INDEX IX_RewardPointDetails_MemberId ON [dbo].[RewardPointDetails](MemberId);
        CREATE NONCLUSTERED INDEX IX_RewardPointDetails_SettlementId ON [dbo].[RewardPointDetails](SettlementId);
      END
    `);

    // 🏆 REWARD POINTS: Add RewardPointDetails columns for backward compat if table already existed
    await runQuery("RewardPointDetails - PointsUsed", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'PointsUsed') ALTER TABLE [dbo].[RewardPointDetails] ADD PointsUsed DECIMAL(18,4) NOT NULL DEFAULT 0");
    await runQuery("RewardPointDetails - TransType", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'TransType') ALTER TABLE [dbo].[RewardPointDetails] ADD TransType NVARCHAR(20) NOT NULL DEFAULT 'EARN'");
    await runQuery("RewardPointDetails - MemberId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'MemberId') ALTER TABLE [dbo].[RewardPointDetails] ADD MemberId UNIQUEIDENTIFIER NULL");
    await runQuery("RewardPointDetails - SettlementId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'SettlementId') ALTER TABLE [dbo].[RewardPointDetails] ADD SettlementId UNIQUEIDENTIFIER NULL");
    await runQuery("RewardPointDetails - BillNo", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'BillNo') ALTER TABLE [dbo].[RewardPointDetails] ADD BillNo NVARCHAR(50) NULL");
    await runQuery("RewardPointDetails - BillAmount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'BillAmount') ALTER TABLE [dbo].[RewardPointDetails] ADD BillAmount DECIMAL(18,2) NOT NULL DEFAULT 0");
    await runQuery("RewardPointDetails - PointsEarned", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'PointsEarned') ALTER TABLE [dbo].[RewardPointDetails] ADD PointsEarned DECIMAL(18,4) NOT NULL DEFAULT 0");
    await runQuery("RewardPointDetails - PayMode", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'PayMode') ALTER TABLE [dbo].[RewardPointDetails] ADD PayMode NVARCHAR(50) NULL");
    await runQuery("RewardPointDetails - Remarks", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'Remarks') ALTER TABLE [dbo].[RewardPointDetails] ADD Remarks NVARCHAR(255) NULL");
    await runQuery("RewardPointDetails - CreatedOn", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RewardPointDetails]') AND name = 'CreatedOn') ALTER TABLE [dbo].[RewardPointDetails] ADD CreatedOn DATETIME DEFAULT GETDATE()");


    // 2.1 CreditCustomerMaster (Dedicated Credit Accounts table separate from Members)
    await runQuery("Create CreditCustomerMaster", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CreditCustomerMaster]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CreditCustomerMaster](
              [CustomerId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [Name] [nvarchar](255) NOT NULL,
              [Phone] [nvarchar](50) NULL,
              [Email] [nvarchar](255) NULL,
              [Address] [nvarchar](max) NULL,
              [IsActive] [bit] DEFAULT 1,
              [Balance] [decimal](18, 2) DEFAULT 0,
              [CreditLimit] [decimal](18, 2) DEFAULT 0,
              [CurrentBalance] [decimal](18, 2) DEFAULT 0,
              [CreatedOn] [datetime] DEFAULT GETDATE()
          )
      END
    `);

    // 3. SettlementHeader Columns
    await runQuery("SettlementHeader - IsCancelled", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'IsCancelled') ALTER TABLE [dbo].[SettlementHeader] ADD IsCancelled BIT DEFAULT 0");
    await runQuery("SettlementHeader - CancellationReason", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'CancellationReason') ALTER TABLE [dbo].[SettlementHeader] ADD CancellationReason NVARCHAR(255)");
    await runQuery("SettlementHeader - CancelledBy", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'CancelledBy') ALTER TABLE [dbo].[SettlementHeader] ADD CancelledBy UNIQUEIDENTIFIER NULL");
    await runQuery("SettlementHeader - CancelledDate", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'CancelledDate') ALTER TABLE [dbo].[SettlementHeader] ADD CancelledDate DATETIME NULL");
    await runQuery("SettlementHeader - CancelledByUserName", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'CancelledByUserName') ALTER TABLE [dbo].[SettlementHeader] ADD CancelledByUserName NVARCHAR(100) NULL");
    await runQuery("SettlementHeader - SER_NAME", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'SER_NAME') ALTER TABLE [dbo].[SettlementHeader] ADD SER_NAME NVARCHAR(255)");
    await runQuery("SettlementHeader - VoidItemQty", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'VoidItemQty') ALTER TABLE [dbo].[SettlementHeader] ADD VoidItemQty INT DEFAULT 0");
    await runQuery("SettlementHeader - VoidItemAmount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'VoidItemAmount') ALTER TABLE [dbo].[SettlementHeader] ADD VoidItemAmount DECIMAL(18, 2) DEFAULT 0");
    await runQuery("SettlementHeader - ServiceCharge", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'ServiceCharge') ALTER TABLE [dbo].[SettlementHeader] ADD ServiceCharge DECIMAL(18, 2) DEFAULT 0");
    await runQuery("SettlementHeader - RoundedBy", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'RoundedBy') ALTER TABLE [dbo].[SettlementHeader] ADD RoundedBy DECIMAL(18, 2) DEFAULT 0");

    // 4. SettlementItemDetail Columns
    await runQuery("SettlementItemDetail - Status", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'Status') ALTER TABLE [dbo].[SettlementItemDetail] ADD Status NVARCHAR(50) NULL");
    await runQuery("SettlementItemDetail - CategoryName", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'CategoryName') ALTER TABLE [dbo].[SettlementItemDetail] ADD CategoryName NVARCHAR(255) NULL");
    await runQuery("SettlementItemDetail - SubCategoryName", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'SubCategoryName') ALTER TABLE [dbo].[SettlementItemDetail] ADD SubCategoryName NVARCHAR(255) NULL");
    await runQuery("SettlementItemDetail - Spicy", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'Spicy') ALTER TABLE [dbo].[SettlementItemDetail] ADD Spicy NVARCHAR(50) NULL");
    await runQuery("SettlementItemDetail - Salt", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'Salt') ALTER TABLE [dbo].[SettlementItemDetail] ADD Salt NVARCHAR(50) NULL");
    await runQuery("SettlementItemDetail - Oil", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'Oil') ALTER TABLE [dbo].[SettlementItemDetail] ADD Oil NVARCHAR(50) NULL");
    await runQuery("SettlementItemDetail - Sugar", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'Sugar') ALTER TABLE [dbo].[SettlementItemDetail] ADD Sugar NVARCHAR(50) NULL");
    await runQuery("SettlementItemDetail - OrderDetailId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'OrderDetailId') ALTER TABLE [dbo].[SettlementItemDetail] ADD OrderDetailId UNIQUEIDENTIFIER NULL");
    await runQuery("SettlementItemDetail - SongName", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'SongName') ALTER TABLE [dbo].[SettlementItemDetail] ADD SongName NVARCHAR(255) NULL");
    await runQuery("SettlementItemDetail - Decimal Qty Migration", `
      IF EXISTS (
        SELECT 1 FROM sys.columns c
        JOIN sys.types t ON c.system_type_id = t.system_type_id
        WHERE c.object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]')
          AND c.name = 'Qty'
          AND t.name = 'int'
      )
      BEGIN
          ALTER TABLE [dbo].[SettlementItemDetail] ALTER COLUMN [Qty] DECIMAL(18, 3) NULL;
      END
    `);

    // 5. CancelRemarksMaster
    await runQuery("Create CancelRemarksMaster", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CancelRemarksMaster]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CancelRemarksMaster](
              [CRCode] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
              [CRName] [nvarchar](255) NOT NULL,
              [IsActive] [bit] DEFAULT 1
          )
      END
    `);

    await runQuery("Insert CancelRemarks", `
      IF NOT EXISTS (SELECT TOP 1 1 FROM [dbo].[CancelRemarksMaster])
      BEGIN
          INSERT INTO [dbo].[CancelRemarksMaster] (CRName, IsActive) VALUES 
          ('Customer Changed Mind', 1),
          ('Order Error', 1),
          ('Duplicate Order', 1),
          ('Long Wait Time', 1),
          ('Technical Issue', 1),
          ('Out of Stock', 1)
      END
    `);

    // 6. CartItems
    await runQuery("Create CartItems", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CartItems]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CartItems](
              [ItemId] [nvarchar](128) NOT NULL PRIMARY KEY,
              [CartId] [nvarchar](max) NULL,
              [ProductId] [nvarchar](128) NULL,
              [Quantity] [int] NULL,
              [Cost] [decimal](18, 2) NULL,
              [OrderNo] [nvarchar](max) NULL,
              [OrderConfirmQty] [int] NULL,
              [DateCreated] [datetime] DEFAULT GETDATE()
          )
      END
    `);

    // 7. SettlementDiscountDetail
    await runQuery("Create SettlementDiscountDetail", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettlementDiscountDetail]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[SettlementDiscountDetail](
              [ID] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
              [SettlementId] [uniqueidentifier] NULL,
              [DiscountId] [uniqueidentifier] NULL,
              [Description] [nvarchar](255) NULL,
              [SysAmount] [decimal](18, 2) NULL,
              [ManualAmount] [decimal](18, 2) NULL,
              [SortageOrExces] [decimal](18, 2) NULL
          )
      END
    `);

    // 8. POS Nitro Professional Updates
    await runQuery("RestaurantOrderDetailCur - ModifiersJSON", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetailCur]') AND name = 'ModifiersJSON') ALTER TABLE [dbo].[RestaurantOrderDetailCur] ADD ModifiersJSON NVARCHAR(MAX)");
    await runQuery("RestaurantOrderDetailCur - OrderNumber", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetailCur]') AND name = 'OrderNumber') ALTER TABLE [dbo].[RestaurantOrderDetailCur] ADD OrderNumber NVARCHAR(100)");
    await runQuery("RestaurantOrderDetailCur - Remarks", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetailCur]') AND name = 'Remarks') ALTER TABLE [dbo].[RestaurantOrderDetailCur] ADD Remarks NVARCHAR(300)");
    await runQuery("RestaurantOrderDetailCur - isTakeAway", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetailCur]') AND name = 'isTakeAway') ALTER TABLE [dbo].[RestaurantOrderDetailCur] ADD isTakeAway BIT DEFAULT 0");

    await runQuery("TableMaster - CurrentOrderId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TableMaster]') AND name = 'CurrentOrderId') ALTER TABLE [dbo].[TableMaster] ADD CurrentOrderId NVARCHAR(100)");
    await runQuery("TableMaster - entry_status", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TableMaster]') AND name = 'entry_status') ALTER TABLE [dbo].[TableMaster] ADD entry_status VARCHAR(50) NULL");
    await runQuery("TableMaster - CustomerName", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TableMaster]') AND name = 'CustomerName') ALTER TABLE [dbo].[TableMaster] ADD CustomerName NVARCHAR(100) NULL");
    await runQuery("TableMaster - Pax", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TableMaster]') AND name = 'Pax') ALTER TABLE [dbo].[TableMaster] ADD Pax INT NULL");
    await runQuery("TableMaster - PAYMENT_STATUS", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TableMaster]') AND name = 'PAYMENT_STATUS') ALTER TABLE [dbo].[TableMaster] ADD PAYMENT_STATUS INT NULL");

    await runQuery("TableMaster - Status type to INT", "IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TableMaster]') AND name = 'Status' AND system_type_id = 104) BEGIN DECLARE @df VARCHAR(256); SELECT @df = name FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('TableMaster') AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('TableMaster'), 'Status', 'ColumnId'); IF @df IS NOT NULL EXEC('ALTER TABLE TableMaster DROP CONSTRAINT ' + @df); ALTER TABLE TableMaster ALTER COLUMN Status INT NULL; END");
    await runQuery("Create OrderSequences", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[OrderSequences]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[OrderSequences](
              [RestaurantId] [uniqueidentifier] NOT NULL,
              [SequenceDate] [date] NOT NULL,
              [LastNumber] [int] NOT NULL DEFAULT 0,
              PRIMARY KEY ([RestaurantId], [SequenceDate])
          )
      END
    `);

    // 9. Ensure Discount Columns in Professional Tables
    await runQuery("RestaurantOrderDetailCur - DiscountAmount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetailCur]') AND name = 'DiscountAmount') ALTER TABLE [dbo].[RestaurantOrderDetailCur] ADD DiscountAmount DECIMAL(18, 2) DEFAULT 0");
    await runQuery("RestaurantOrderDetailCur - DiscountType", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetailCur]') AND name = 'DiscountType') ALTER TABLE [dbo].[RestaurantOrderDetailCur] ADD DiscountType NVARCHAR(50)");

    await runQuery("RestaurantOrderDetail - DiscountAmount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetail]') AND name = 'DiscountAmount') ALTER TABLE [dbo].[RestaurantOrderDetail] ADD DiscountAmount DECIMAL(18, 2) DEFAULT 0");
    await runQuery("RestaurantOrderDetail - DiscountType", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetail]') AND name = 'DiscountType') ALTER TABLE [dbo].[RestaurantOrderDetail] ADD DiscountType NVARCHAR(50)");

    await runQuery("SettlementHeader - DiscountAmount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'DiscountAmount') ALTER TABLE [dbo].[SettlementHeader] ADD DiscountAmount DECIMAL(18, 2) DEFAULT 0");
    await runQuery("SettlementHeader - DiscountType", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'DiscountType') ALTER TABLE [dbo].[SettlementHeader] ADD DiscountType NVARCHAR(50)");
    await runQuery("SettlementHeader - entry_status", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'entry_status') ALTER TABLE [dbo].[SettlementHeader] ADD entry_status VARCHAR(50) NULL");

    // 10. Performance Indexes
    await runQuery("Index - SettlementHeader Date", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SettlementHeader_Date') CREATE INDEX IX_SettlementHeader_Date ON [dbo].[SettlementHeader] (LastSettlementDate)");
    await runQuery("Index - SettlementHeader BillNo", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SettlementHeader_BillNo') CREATE INDEX IX_SettlementHeader_BillNo ON [dbo].[SettlementHeader] (BillNo)");
    await runQuery("Index - SettlementItemDetail ID", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SettlementItemDetail_SID') CREATE INDEX IX_SettlementItemDetail_SID ON [dbo].[SettlementItemDetail] (SettlementID)");
    await runQuery("Index - RestaurantOrderCur Tableno", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderCur_Tableno') CREATE INDEX IX_RestaurantOrderCur_Tableno ON [dbo].[RestaurantOrderCur] (Tableno)");
    await runQuery("Index - RestaurantOrderCur OrderNo", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderCur_OrderNo') CREATE INDEX IX_RestaurantOrderCur_OrderNo ON [dbo].[RestaurantOrderCur] (OrderNumber)");
    await runQuery("Index - RestaurantOrderCur ClosedCreated", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderCur_ClosedCreated') CREATE INDEX IX_RestaurantOrderCur_ClosedCreated ON [dbo].[RestaurantOrderCur] (isOrderClosed, CreatedOn)");
    await runQuery("Index - RestaurantOrderDetailCur OrderId", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderDetailCur_OrderId') CREATE INDEX IX_RestaurantOrderDetailCur_OrderId ON [dbo].[RestaurantOrderDetailCur] (OrderId)");
    await runQuery("Index - TableMaster SortCode", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TableMaster_SortCode') CREATE INDEX IX_TableMaster_SortCode ON [dbo].[TableMaster] (SortCode)");
    await runQuery("Index - TableMaster TableNumber", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TableMaster_TableNumber') CREATE INDEX IX_TableMaster_TableNumber ON [dbo].[TableMaster] (TableNumber)");
    await runQuery("Index - RestaurantOrder Tableno", "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrder_Tableno') CREATE INDEX IX_RestaurantOrder_Tableno ON [dbo].[RestaurantOrder] (Tableno)");

    // 11. CompanySettings
    await runQuery("Create CompanySettings", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CompanySettings]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CompanySettings](
              [Id] [nvarchar](50) NOT NULL PRIMARY KEY,
              [CompanyName] [nvarchar](255) NULL,
              [Address] [nvarchar](max) NULL,
              [GSTNo] [nvarchar](50) NULL,
              [GSTPercentage] [decimal](18, 2) NULL,
              [Phone] [nvarchar](50) NULL,
              [Email] [nvarchar](255) NULL,
              [CashierName] [nvarchar](100) NULL,
              [Currency] [nvarchar](50) NULL,
              [CurrencySymbol] [nvarchar](10) NULL,
              [CompanyLogoUrl] [nvarchar](max) NULL,
              [HalalLogoUrl] [nvarchar](max) NULL,
              [PrinterIP] [nvarchar](50) NULL,
              [ShowCompanyLogo] [bit] DEFAULT 0,
              [ShowHalalLogo] [bit] DEFAULT 0,
              [TaxMode] [nvarchar](50) DEFAULT 'exclusive',
              [WaiterRequired] [bit] DEFAULT 0,
              [HoldOvertimeMinutes] [int] DEFAULT 30,
              [SVCIdentification] [bit] DEFAULT 1,
              [UpdatedOn] [datetime] DEFAULT GETDATE()
          )
      END
    `);
    await runQuery("CompanySettings - HoldOvertimeMinutes", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CompanySettings]') AND name = 'HoldOvertimeMinutes') ALTER TABLE [dbo].[CompanySettings] ADD HoldOvertimeMinutes INT DEFAULT 30");
    await runQuery("CompanySettings - ServiceChargePercentage", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CompanySettings]') AND name = 'ServiceChargePercentage') ALTER TABLE [dbo].[CompanySettings] ADD ServiceChargePercentage DECIMAL(18, 2) DEFAULT 0");
    await runQuery("CompanySettings - SVCIdentification", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CompanySettings]') AND name = 'SVCIdentification') ALTER TABLE [dbo].[CompanySettings] ADD SVCIdentification BIT NOT NULL DEFAULT 1");
    await runQuery("CompanySettings - TakeawayCharges", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CompanySettings]') AND name = 'TakeawayCharges') ALTER TABLE [dbo].[CompanySettings] ADD TakeawayCharges DECIMAL(18, 2) DEFAULT 0");
    await runQuery("CompanySettings - TWServiceChargePercentage", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CompanySettings]') AND name = 'TWServiceChargePercentage') ALTER TABLE [dbo].[CompanySettings] ADD TWServiceChargePercentage DECIMAL(10, 2) NULL");
    await runQuery("CompanySettings - LastBridgeHeartbeat", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CompanySettings]') AND name = 'LastBridgeHeartbeat') ALTER TABLE [dbo].[CompanySettings] ADD LastBridgeHeartbeat DATETIME");

    // 11.1 SettingsAuditLog Table Schema
    await runQuery("Create SettingsAuditLog", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettingsAuditLog]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[SettingsAuditLog] (
          [AuditId] UNIQUEIDENTIFIER DEFAULT NEWID() PRIMARY KEY,
          [Category] NVARCHAR(50) NOT NULL,
          [FieldName] NVARCHAR(100) NOT NULL,
          [FieldLabel] NVARCHAR(100) NOT NULL,
          [OldValue] NVARCHAR(MAX) NULL,
          [NewValue] NVARCHAR(MAX) NULL,
          [ModifiedBy] NVARCHAR(100) NOT NULL,
          [UserId] NVARCHAR(50) NULL,
          [UserRole] NVARCHAR(50) NULL,
          [CreatedAt] DATETIME DEFAULT DATEADD(MINUTE, 480, GETUTCDATE())
        );
        CREATE INDEX IX_SettingsAuditLog_CreatedAt ON [dbo].[SettingsAuditLog](CreatedAt DESC);
        CREATE INDEX IX_SettingsAuditLog_Category ON [dbo].[SettingsAuditLog](Category);
      END
    `);
    await runQuery("AppSettings - EnableCheckoutFlow", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableCheckoutFlow') ALTER TABLE [dbo].[AppSettings] ADD EnableCheckoutFlow BIT NOT NULL DEFAULT 1");
    await runQuery("AppSettings - EnableDirectProcessToPay", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableDirectProcessToPay') ALTER TABLE [dbo].[AppSettings] ADD EnableDirectProcessToPay BIT NOT NULL DEFAULT 0");
    await runQuery("AppSettings - EnableDirectPaymentToProcess", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableDirectPaymentToProcess') ALTER TABLE [dbo].[AppSettings] ADD EnableDirectPaymentToProcess BIT NOT NULL DEFAULT 0");
    await runQuery("AppSettings - EnableSkipSummaryScreen", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableSkipSummaryScreen') ALTER TABLE [dbo].[AppSettings] ADD EnableSkipSummaryScreen BIT NOT NULL DEFAULT 0");
    await runQuery("AppSettings - CustomerSideDisplay", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'CustomerSideDisplay') ALTER TABLE [dbo].[AppSettings] ADD CustomerSideDisplay BIT NOT NULL DEFAULT 1");
    await runQuery("AppSettings - EnableGuestDetailsPopup", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableGuestDetailsPopup') ALTER TABLE [dbo].[AppSettings] ADD EnableGuestDetailsPopup BIT NOT NULL DEFAULT 1");
    await runQuery("AppSettings - EnableCashDrawer", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableCashDrawer') ALTER TABLE [dbo].[AppSettings] ADD EnableCashDrawer BIT NOT NULL DEFAULT 1");
    await runQuery("AppSettings - EnableOnlinePayment", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableOnlinePayment') ALTER TABLE [dbo].[AppSettings] ADD EnableOnlinePayment BIT NOT NULL DEFAULT 1");
    await runQuery("AppSettings - EnableComboPrint", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableComboPrint') ALTER TABLE [dbo].[AppSettings] ADD EnableComboPrint BIT NOT NULL DEFAULT 0");
    await runQuery("AppSettings - EnableCookingInstructions", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableCookingInstructions') ALTER TABLE [dbo].[AppSettings] ADD EnableCookingInstructions BIT NOT NULL DEFAULT 1");
    await runQuery("AppSettings - EnableReceiptPrint", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[AppSettings]') AND name = 'EnableReceiptPrint') ALTER TABLE [dbo].[AppSettings] ADD EnableReceiptPrint BIT NOT NULL DEFAULT 1");
    await runQuery("RestaurantOrderCur - TakeawayCharge", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderCur]') AND name = 'TakeawayCharge') ALTER TABLE [dbo].[RestaurantOrderCur] ADD TakeawayCharge DECIMAL(18, 2) DEFAULT 0");
    await runQuery("RestaurantOrder - TakeawayCharge", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrder]') AND name = 'TakeawayCharge') ALTER TABLE [dbo].[RestaurantOrder] ADD TakeawayCharge DECIMAL(18, 2) DEFAULT 0");
    await runQuery("SettlementHeader - TakeawayCharge", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'TakeawayCharge') ALTER TABLE [dbo].[SettlementHeader] ADD TakeawayCharge DECIMAL(18, 2) DEFAULT 0");

    // 11. OrderMergeHistory Setup
    await runQuery("Create OrderMergeHistory", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[OrderMergeHistory]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[OrderMergeHistory] (
          [MergeId] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          [ParentOrderId] UNIQUEIDENTIFIER NOT NULL,
          [ChildOrderId] UNIQUEIDENTIFIER NOT NULL,
          [ParentTableNo] NVARCHAR(50) NULL,
          [ChildTableNo] NVARCHAR(50) NULL,
          [MergedAt] DATETIME NOT NULL DEFAULT GETDATE(),
          [MergedBy] UNIQUEIDENTIFIER NULL,
          CONSTRAINT [PK_OrderMergeHistory] PRIMARY KEY CLUSTERED ([MergeId] ASC)
        )
      END
    `);


    await runQuery("Insert Default CompanySettings", `
      IF NOT EXISTS (SELECT TOP 1 1 FROM [dbo].[CompanySettings])
      BEGIN
          INSERT INTO [dbo].[CompanySettings] (Id, CompanyName, UpdatedOn) VALUES ('1', 'UCS POS', GETDATE())
      END
    `);

    // 12. Insert MEMBER & CREDIT Paymode if missing
    await runQuery("Insert MEMBER Paymode", `
      IF NOT EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(PayMode)) = 'MEMBER')
      BEGIN
          INSERT INTO [dbo].[Paymode] (Position, PayMode, Description, Active)
          VALUES (5, 'MEMBER', 'MEMBER', 1)
      END
    `);

    await runQuery("Insert CREDIT Paymode", `
      IF NOT EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(PayMode)) = 'CREDIT')
      BEGIN
          INSERT INTO [dbo].[Paymode] (Position, PayMode, Description, Active)
          VALUES (6, 'CREDIT', 'CREDIT', 1)
      END
    `);

    // 13. Create AIChatSessions and AIChatMessages tables
    await runQuery("Create AIChatSessions", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AIChatSessions]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[AIChatSessions] (
          [SessionID] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
          [OrgID] INT NULL,
          [StoreID] INT NULL,
          [UserID] INT NULL,
          [Title] NVARCHAR(255) NULL,
          [CreatedAt] DATETIME NOT NULL DEFAULT GETDATE(),
          [LastActivityAt] DATETIME NOT NULL DEFAULT GETDATE()
        )
      END
    `);

    await runQuery("Create AIChatMessages", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AIChatMessages]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[AIChatMessages] (
          [MessageID] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          [SessionID] UNIQUEIDENTIFIER NOT NULL,
          [Sender] NVARCHAR(50) NOT NULL,
          [ContentText] NVARCHAR(MAX) NULL,
          [StructuredPayload] NVARCHAR(MAX) NULL,
          [SQLExecuted] NVARCHAR(MAX) NULL,
          [ResponseTimeMs] INT NULL,
          [Timestamp] DATETIME NOT NULL DEFAULT GETDATE(),
          CONSTRAINT [FK_AIChatMessages_AIChatSessions] FOREIGN KEY ([SessionID]) REFERENCES [dbo].[AIChatSessions] ([SessionID]) ON DELETE CASCADE
        )
      END
    `);

    // 14. Create PaymentTransactionDetails table for unified split payments
    await runQuery("Create PaymentTransactionDetails", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PaymentTransactionDetails]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[PaymentTransactionDetails](
              [PaymentTransactionId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [ReferenceType] [nvarchar](50) NOT NULL,
              [ReferenceId] [uniqueidentifier] NOT NULL,
              [PayModeId] [int] NOT NULL,
              [Amount] [decimal](18, 2) NOT NULL,
              [ReferenceNo] [nvarchar](100) NULL,
              [CreatedDate] [datetime] NOT NULL DEFAULT GETDATE(),
              [CreatedBy] [uniqueidentifier] NULL
          )
      END
    `);

    // Upgrade: Add start_date column to PaymentTransactionDetails for business date alignment
    await runQuery("Upgrade PaymentTransactionDetails - Add start_date", `
      IF COL_LENGTH('dbo.PaymentTransactionDetails', 'start_date') IS NULL
      BEGIN
          ALTER TABLE [dbo].[PaymentTransactionDetails] ADD [start_date] DATE NULL
      END
    `);

    // Backfill start_date for PaymentTransactionDetails
    await runQuery("Backfill PaymentTransactionDetails start_date", `
      UPDATE ptd
      SET ptd.start_date = COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE))
      FROM PaymentTransactionDetails ptd
      JOIN SettlementHeader sh ON sh.SettlementID = ptd.ReferenceId
      WHERE ptd.start_date IS NULL AND ptd.ReferenceType = 'BILL';

      UPDATE ptd
      SET ptd.start_date = cct.start_date
      FROM PaymentTransactionDetails ptd
      JOIN CustomerCreditTransactions cct ON cct.MemberId = ptd.ReferenceId AND cct.TransactionType = 'PAYMENT' AND cct.start_date IS NOT NULL
      WHERE ptd.start_date IS NULL AND ptd.ReferenceType = 'MEMBER';

      UPDATE PaymentTransactionDetails
      SET start_date = CAST(CreatedDate AS DATE)
      WHERE start_date IS NULL;
    `);


    // 15. Create CustomerCreditTransactions table for credit and payment ledger history
    // Upgrade Detector: Drop old table format if missing new 'BillAmount' column
    await runQuery("Upgrade CustomerCreditTransactions Detector", `
      IF OBJECT_ID('dbo.CustomerCreditTransactions', 'U') IS NOT NULL AND COL_LENGTH('dbo.CustomerCreditTransactions', 'BillAmount') IS NULL
      BEGIN
          DROP TABLE [dbo].[CustomerCreditTransactions]
      END
    `);

    // Upgrade: Drop the FK constraint if it exists to allow referencing CreditCustomerMaster
    await runQuery("Drop CustomerCreditTransactions FK Constraint", `
      IF EXISTS (SELECT * FROM sys.foreign_keys WHERE object_id = OBJECT_ID(N'[dbo].[FK_CreditTrans_Member]') AND parent_object_id = OBJECT_ID(N'[dbo].[CustomerCreditTransactions]'))
      BEGIN
          ALTER TABLE [dbo].[CustomerCreditTransactions] DROP CONSTRAINT [FK_CreditTrans_Member]
      END
    `);

    await runQuery("Create CustomerCreditTransactions", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CustomerCreditTransactions]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CustomerCreditTransactions](
              [TransactionId] UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
              [MemberId] UNIQUEIDENTIFIER NOT NULL, -- Serves as the CustomerId for CreditCustomerMaster
              [SettlementId] UNIQUEIDENTIFIER NULL,
              [BillNo] NVARCHAR(50) NULL,
              [TransactionType] NVARCHAR(20) NOT NULL, -- 'CREDIT_SALE', 'PAYMENT', 'ADJUSTMENT'
              [BillAmount] DECIMAL(18, 2) DEFAULT 0,
              [PaidAmount] DECIMAL(18, 2) DEFAULT 0,
              [OutstandingAmount] DECIMAL(18, 2) DEFAULT 0,
              [PaymentMethod] NVARCHAR(50) NULL,
              [ReferenceNo] NVARCHAR(100) NULL,
              [Status] NVARCHAR(20) DEFAULT 'OPEN', -- 'OPEN', 'PARTIAL', 'CLOSED'
              [Remarks] NVARCHAR(500) NULL,
              [CreatedBy] UNIQUEIDENTIFIER NULL,
              [CreatedDate] DATETIME2 NOT NULL DEFAULT GETDATE(),
              [UpdatedDate] DATETIME2 NULL
          )
      END
    `);

    // Upgrade: Add CustomerType column for reporting accuracy
    await runQuery("Upgrade CustomerCreditTransactions - Add CustomerType", `
      IF COL_LENGTH('dbo.CustomerCreditTransactions', 'CustomerType') IS NULL
      BEGIN
          ALTER TABLE [dbo].[CustomerCreditTransactions] ADD [CustomerType] NVARCHAR(20) NULL
      END
    `);

    // Upgrade: Add start_date column for business day alignment
    await runQuery("Upgrade CustomerCreditTransactions - Add start_date", `
      IF COL_LENGTH('dbo.CustomerCreditTransactions', 'start_date') IS NULL
      BEGIN
          ALTER TABLE [dbo].[CustomerCreditTransactions] ADD [start_date] DATE NULL
      END
    `);

    await runQuery("Index - CustomerCreditTransactions MemberId", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CreditTrans_MemberId' AND object_id = OBJECT_ID('CustomerCreditTransactions'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_CreditTrans_MemberId 
        ON CustomerCreditTransactions(MemberId) 
        INCLUDE (TransactionType, OutstandingAmount, BillNo, Status)
      END
    `);

    await runQuery("Index - CustomerCreditTransactions Settlement", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CreditTrans_Settlement' AND object_id = OBJECT_ID('CustomerCreditTransactions'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_CreditTrans_Settlement 
        ON CustomerCreditTransactions(SettlementId) 
        INCLUDE (TransactionType, OutstandingAmount, Status)
      END
    `);

    // Backfill DISABLED — user wants fresh start, no auto-population from MemberMaster
    // await runQuery("Backfill CustomerCreditTransactions", `
    //   IF NOT EXISTS (SELECT TOP 1 1 FROM [dbo].[CustomerCreditTransactions])
    //   BEGIN
    //       INSERT INTO [dbo].[CustomerCreditTransactions] (MemberId, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedDate)
    //       SELECT MemberId, 'ADJUSTMENT', CurrentBalance, 0, CurrentBalance, 'OPEN', 'Balance migration from legacy profile', GETDATE()
    //       FROM MemberMaster
    //       WHERE CurrentBalance > 0
    //   END
    // `);

    await runQuery("Create CustomerCreditAllocations", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CustomerCreditAllocations]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CustomerCreditAllocations](
              [AllocationId] UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
              [PaymentTransactionId] UNIQUEIDENTIFIER NOT NULL,
              [InvoiceTransactionId] UNIQUEIDENTIFIER NOT NULL,
              [Amount] DECIMAL(18, 2) NOT NULL,
              [CreatedDate] DATETIME2 NOT NULL DEFAULT GETDATE()
          )
      END
    `);

    await runQuery("Index - CustomerCreditAllocations PaymentTransactionId", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CreditAlloc_PaymentTransactionId' AND object_id = OBJECT_ID('CustomerCreditAllocations'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_CreditAlloc_PaymentTransactionId 
        ON CustomerCreditAllocations(PaymentTransactionId)
      END
    `);

    await runQuery("Index - CustomerCreditAllocations InvoiceTransactionId", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CreditAlloc_InvoiceTransactionId' AND object_id = OBJECT_ID('CustomerCreditAllocations'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_CreditAlloc_InvoiceTransactionId 
        ON CustomerCreditAllocations(InvoiceTransactionId)
      END
    `);

    // 16. Create settlement table
    await runQuery("Create settlement table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[settlement]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[settlement](
              [Id] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
              [OutletId] [int] NULL,
              [SettlementDate] [date] NULL,
              [CashierName] [nvarchar](100) NULL,
              [OpeningCashJSON] [nvarchar](max) NULL,
              [OpeningCashTotal] [decimal](10, 2) NULL,
              [PhysicalCashJSON] [nvarchar](max) NULL,
              [PhysicalCashTotal] [decimal](10, 2) NULL,
              [TotalSales] [decimal](10, 2) NULL,
              [TotalDiscount] [decimal](10, 2) NULL,
              [VoidAmount] [decimal](10, 2) NULL,
              [NetSales] [decimal](10, 2) NULL,
              [CashReceived] [decimal](10, 2) NULL,
              [ExpectedClosingCash] [decimal](10, 2) NULL,
              [CashVariance] [decimal](10, 2) NULL,
              [VarianceStatus] [nvarchar](50) NULL,
              [PaymentBreakdownJSON] [nvarchar](max) NULL,
              [Status] [nvarchar](50) NULL,
              [SettledBy] [nvarchar](100) NULL,
              [SettledAt] [datetime] NULL,
              [CreatedAt] [datetime] NULL,
              [UpdatedAt] [datetime] NULL
          )
      END
    `);

    // 17. Create OpeningCashDenomination table
    await runQuery("Create OpeningCashDenomination table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[OpeningCashDenomination]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[OpeningCashDenomination](
              [Id] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
              [CurrencyValue] [decimal](18, 2) NULL,
              [NoteCount] [int] NULL,
              [Type] [nvarchar](50) NULL,
              [CreatedBy] [nvarchar](100) NULL,
              [CreatedOn] [datetime] NULL
          )
      END
    `);

    await runQuery("OpeningCashDenomination - ScreenType", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[OpeningCashDenomination]') AND name = 'ScreenType') ALTER TABLE [dbo].[OpeningCashDenomination] ADD ScreenType NVARCHAR(50) NULL");
    await runQuery("OpeningCashDenomination - start_date", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[OpeningCashDenomination]') AND name = 'start_date') ALTER TABLE [dbo].[OpeningCashDenomination] ADD start_date DATE NULL");

    // 18. Create CashOutEntry table
    await runQuery("Create CashOutEntry table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CashOutEntry]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CashOutEntry](
              [CashOutId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [CashOutNo] [nvarchar](50) NULL,
              [CashOutDate] [date] NULL DEFAULT CAST(GETDATE() AS DATE),
              [Amount] [decimal](18, 2) NULL,
              [Reason] [nvarchar](255) NULL,
              [Remarks] [nvarchar](max) NULL,
              [PaymentMode] [nvarchar](50) NULL,
              [ReferenceNo] [nvarchar](100) NULL,
              [TerminalCode] [nvarchar](50) NULL,
              [CreatedBy] [nvarchar](100) NULL,
              [CreatedOn] [datetime] NULL,
              [start_date] [date] NULL,
              [AttachmentUrl] [nvarchar](500) NULL
          )
      END
    `);

    // Ensure start_date exists in CashOutEntry
    await runQuery("CashOutEntry - start_date", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashOutEntry]') AND name = 'start_date') ALTER TABLE [dbo].[CashOutEntry] ADD [start_date] DATE NULL");

    // Ensure AttachmentUrl exists in CashOutEntry
    await runQuery("CashOutEntry - AttachmentUrl", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashOutEntry]') AND name = 'AttachmentUrl') ALTER TABLE [dbo].[CashOutEntry] ADD [AttachmentUrl] NVARCHAR(500) NULL");

    // 18.1 Create CashInEntry table (for manual Cash-In tracking)
    await runQuery("Create CashInEntry table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CashInEntry]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CashInEntry](
              [CashInId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [CashInNo] [nvarchar](50) NULL,
              [CashInDate] [date] NULL DEFAULT CAST(GETDATE() AS DATE),
              [Amount] [decimal](18, 2) NULL,
              [Reason] [nvarchar](255) NULL,
              [Remarks] [nvarchar](max) NULL,
              [PaymentMode] [nvarchar](50) NULL,
              [ReferenceNo] [nvarchar](100) NULL,
              [TerminalCode] [nvarchar](50) NULL,
              [CreatedBy] [nvarchar](100) NULL,
              [CreatedOn] [datetime] NULL,
              [start_date] [date] NULL,
              [AttachmentUrl] [nvarchar](500) NULL
          )
      END
    `);

    // Ensure start_date exists in CashInEntry
    await runQuery("CashInEntry - start_date", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashInEntry]') AND name = 'start_date') ALTER TABLE [dbo].[CashInEntry] ADD [start_date] DATE NULL");

    // Ensure AttachmentUrl exists in CashInEntry
    await runQuery("CashInEntry - AttachmentUrl", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashInEntry]') AND name = 'AttachmentUrl') ALTER TABLE [dbo].[CashInEntry] ADD [AttachmentUrl] NVARCHAR(500) NULL");

    // 18.2 Create ArtistCashBox table
    await runQuery("Create ArtistCashBox table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ArtistCashBox]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[ArtistCashBox](
              [CashBoxId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [ArtistName] [varchar](255) NULL,
              [Amount] [decimal](18, 2) NULL,
              [CreatedDate] [datetime] DEFAULT GETDATE(),
              [SettlementID] [uniqueidentifier] NULL,
              [start_date] [date] NULL
          )
      END
    `);

    // Ensure start_date column exists across all settlement and sales tables
    const tablesNeedingStartDate = [
      'PaymentDetailCur',
      'PaymentDetail',
      'SettlementHeader',
      'SettlementItemDetail',
      'RestaurantInvoice',
      'RestaurantInvoicecur',
      'Restaurantorder',
      'Restaurantordercur',
      'Restaurantorderdetail',
      'Restaurantorderdetailcur',
      'CustomerCreditTransactions',
      'Restaurantmodifierdetail',
      'ArtistCashBox'
    ];

    for (const tbl of tablesNeedingStartDate) {
      await runQuery(`${tbl} - start_date`, `
        IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND type in (N'U'))
        AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND name = 'start_date')
        ALTER TABLE [dbo].[${tbl}] ADD [start_date] DATE NULL
      `);
    }

    // Ensure Pax & related columns exist across all settlement and sales tables
    const paxTables = [
      'SettlementHeader',
      'RestaurantInvoice',
      'RestaurantInvoicecur',
      'Restaurantorder',
      'Restaurantordercur',
      'TableMaster'
    ];

    for (const tbl of paxTables) {
      await runQuery(`${tbl} - Pax`, `
        IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND type in (N'U'))
        AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND name = 'Pax')
        ALTER TABLE [dbo].[${tbl}] ADD [Pax] INT NULL
      `);
    }

    await runQuery("SettlementHeader - TotalPax", `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND type in (N'U'))
      AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'TotalPax')
      ALTER TABLE [dbo].[SettlementHeader] ADD [TotalPax] INT NULL
    `);

    await runQuery("SettlementHeader - GuestName", `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND type in (N'U'))
      AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'GuestName')
      ALTER TABLE [dbo].[SettlementHeader] ADD [GuestName] NVARCHAR(100) NULL
    `);

    await runQuery("SettlementHeader - TakeawayCharge", `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND type in (N'U'))
      AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'TakeawayCharge')
      ALTER TABLE [dbo].[SettlementHeader] ADD [TakeawayCharge] DECIMAL(18, 2) NULL DEFAULT 0
    `);

    await runQuery("SettlementHeader - VoidItemQty", `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND type in (N'U'))
      AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'VoidItemQty')
      ALTER TABLE [dbo].[SettlementHeader] ADD [VoidItemQty] DECIMAL(18, 3) NULL DEFAULT 0
    `);

    await runQuery("SettlementHeader - VoidItemAmount", `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND type in (N'U'))
      AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementHeader]') AND name = 'VoidItemAmount')
      ALTER TABLE [dbo].[SettlementHeader] ADD [VoidItemAmount] DECIMAL(18, 2) NULL DEFAULT 0
    `);

    // Ensure server and servermaster tables exist
    await runQuery("Create server table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[server]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[server](
              [SER_ID] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [SER_NAME] [nvarchar](255) NOT NULL,
              [CreatedBy] [uniqueidentifier] NULL,
              [CreatedDate] [datetime] NULL DEFAULT GETDATE()
          )
      END
    `);

    await runQuery("Create servermaster table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[servermaster]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[servermaster](
              [SER_ID] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [SER_NAME] [nvarchar](255) NOT NULL,
              [CreatedBy] [uniqueidentifier] NULL,
              [CreatedDate] [datetime] NULL DEFAULT GETDATE()
          )
      END
    `);

    // Ensure IsSplitDish and IsGroupDish exist in DishMaster and Dish tables
    const dishTables = ['DishMaster', 'Dish'];
    for (const tbl of dishTables) {
      await runQuery(`${tbl} - IsSplitDish`, `
        IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND type in (N'U'))
        AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND name = 'IsSplitDish')
        ALTER TABLE [dbo].[${tbl}] ADD [IsSplitDish] INT NULL DEFAULT 0
      `);

      await runQuery(`${tbl} - IsGroupDish`, `
        IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND type in (N'U'))
        AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[${tbl}]') AND name = 'IsGroupDish')
        ALTER TABLE [dbo].[${tbl}] ADD [IsGroupDish] INT NULL DEFAULT 0
      `);
    }

    // 19. dishOrderItemShare table creation and updates
    await runQuery("Create dishOrderItemShare table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[dishOrderItemShare]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[dishOrderItemShare](
              [Id] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [CustomerName] [varchar](255) NULL,
              [IsSelected] [bit] NULL DEFAULT 1,
              [CreatedDate] [datetime] NULL DEFAULT GETDATE(),
              [Amount] [decimal](18, 2) NULL DEFAULT 0,
              [FromDate] [date] NULL,
              [ToDate] [date] NULL,
              [DishId] [uniqueidentifier] NULL,
              [OrderDishId] [uniqueidentifier] NULL,
              [TargetAmount] [decimal](18, 2) NULL DEFAULT 0
          )
      END
    `);

    await runQuery("dishOrderItemShare - TargetAmount", `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[dishOrderItemShare]') AND type in (N'U'))
      AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[dishOrderItemShare]') AND name = 'TargetAmount')
      ALTER TABLE [dbo].[dishOrderItemShare] ADD TargetAmount DECIMAL(18, 2) DEFAULT 0
    `);

    // 19.1 Create DateEntry table for Day Start/Day End tracking
    await runQuery("Create DateEntry table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DateEntry]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[DateEntry](
              [DateEntryId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [username] [varchar](30) NULL,
              [StartDate] [date] NOT NULL,
              [CreatedBy] [varchar](30) NULL,
              [CreatedDate] [datetime] DEFAULT GETDATE(),
              [UpdateBy] [varchar](30) NULL,
              [UpdateDate] [datetime] NULL
          )
      END
    `);

    // 19.2 Create BusinessDayLog table for Day Start/End history tracking
    await runQuery("Create BusinessDayLog table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BusinessDayLog]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[BusinessDayLog](
              [BusinessDate] [date] NOT NULL PRIMARY KEY,
              [StartedAt] [datetime] NULL,
              [StartedBy] [nvarchar](50) NULL,
              [EndedAt] [datetime] NULL,
              [EndedBy] [nvarchar](50) NULL
          )
      END
    `);

    // --- Automated schema sync from reference database UCSPONDY ---
    try {
      const ucsPondyCheck = await pool.request().query("SELECT 1 FROM sys.databases WHERE name = 'UCSPONDY'");
      if (ucsPondyCheck.recordset.length > 0) {
        const missingCols = await pool.request().query(`
          SELECT 
            src.TABLE_NAME, 
            src.COLUMN_NAME, 
            src.DATA_TYPE, 
            src.CHARACTER_MAXIMUM_LENGTH, 
            src.NUMERIC_PRECISION, 
            src.NUMERIC_SCALE
          FROM UCSPONDY.INFORMATION_SCHEMA.COLUMNS src
          JOIN UCSSITARAS.INFORMATION_SCHEMA.TABLES tgt_tbl 
            ON src.TABLE_NAME = tgt_tbl.TABLE_NAME AND tgt_tbl.TABLE_TYPE = 'BASE TABLE'
          LEFT JOIN UCSSITARAS.INFORMATION_SCHEMA.COLUMNS tgt
            ON src.TABLE_NAME = tgt.TABLE_NAME AND src.COLUMN_NAME = tgt.COLUMN_NAME
          WHERE tgt.COLUMN_NAME IS NULL
        `);

        for (const col of missingCols.recordset) {
          let typeDef = col.DATA_TYPE.toUpperCase();
          if (['VARCHAR', 'NVARCHAR', 'CHAR', 'NCHAR'].includes(typeDef)) {
            typeDef += col.CHARACTER_MAXIMUM_LENGTH === -1 ? '(MAX)' : `(${col.CHARACTER_MAXIMUM_LENGTH || 255})`;
          } else if (['DECIMAL', 'NUMERIC'].includes(typeDef)) {
            typeDef += `(${col.NUMERIC_PRECISION || 18}, ${col.NUMERIC_SCALE || 2})`;
          }
          await runQuery(`Auto-Sync [${col.TABLE_NAME}].[${col.COLUMN_NAME}]`, `IF COL_LENGTH('dbo.${col.TABLE_NAME}', '${col.COLUMN_NAME}') IS NULL ALTER TABLE [dbo].[${col.TABLE_NAME}] ADD [${col.COLUMN_NAME}] ${typeDef} NULL`);
        }
      }
    } catch (e) {
      console.warn("[AutoSync] Cross-DB schema check warning:", e.message);
    }

    // 19.3 Create BusinessDayAuditLog table for Day Start/End event audit log
    await runQuery("Create BusinessDayAuditLog table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BusinessDayAuditLog]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[BusinessDayAuditLog](
              [AuditId] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
              [BusinessDate] [date] NOT NULL,
              [EventType] [nvarchar](50) NOT NULL,
              [EventTime] [datetime] NOT NULL DEFAULT GETDATE(),
              [ActionBy] [nvarchar](50) NULL,
              [Remarks] [nvarchar](255) NULL
          )
      END
    `);

    // 20. Create CashDrawerRemarks table
    await runQuery("Create CashDrawerRemarks table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerRemarks]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CashDrawerRemarks](
              [Id] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
              [Description] [nvarchar](100) NOT NULL
          )
      END
    `);

    // Ensure Description column exists in CashDrawerRemarks
    await runQuery("CashDrawerRemarks - Description", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerRemarks]') AND name = 'Description') ALTER TABLE [dbo].[CashDrawerRemarks] ADD [Description] NVARCHAR(100) NOT NULL DEFAULT ''");

    // 21. Seed default CashDrawerRemarks
    await runQuery("Seed default CashDrawerRemarks", `
      IF NOT EXISTS (SELECT TOP 1 1 FROM [dbo].[CashDrawerRemarks])
      BEGIN
          INSERT INTO [dbo].[CashDrawerRemarks] (Description) VALUES
          ('Cash In'), ('Cash Out'), ('Opening Float'),
          ('Drawer Check'), ('Other')
      END
    `);

    // Ensure 'Settlement' option exists in CashDrawerRemarks
    await runQuery("Seed Settlement in CashDrawerRemarks", "IF NOT EXISTS (SELECT 1 FROM [dbo].[CashDrawerRemarks] WHERE Description = 'Settlement') INSERT INTO [dbo].[CashDrawerRemarks] (Description) VALUES ('Settlement')");

    // 22. Create CashDrawerLog table
    await runQuery("Create CashDrawerLog table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[CashDrawerLog](
              [LogId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [OutletId] [int] NOT NULL DEFAULT 1,
              [TerminalCode] [nvarchar](50) NULL,
              [ActionType] [nvarchar](30) NULL,
              [Amount] [decimal](18, 2) NULL,
              [TenderedAmount] [decimal](18, 2) NULL,
              [ChangeAmount] [decimal](18, 2) NULL,
              [OrderId] [nvarchar](100) NULL,
              [Reason] [nvarchar](100) NULL,
              [Remark] [nvarchar](500) NULL,
              [OpenedByUserId] [nvarchar](100) NULL,
              [ApprovedByUserId] [nvarchar](100) NULL,
              [OpenSource] [nvarchar](20) NOT NULL,
              [IsSuccess] [bit] NOT NULL DEFAULT 1,
              [CreatedOn] [datetime] DEFAULT GETDATE()
          )
      END
    `);

    // Ensure OpenSource column exists in CashDrawerLog
    await runQuery("CashDrawerLog - OpenSource", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'OpenSource') ALTER TABLE [dbo].[CashDrawerLog] ADD [OpenSource] NVARCHAR(20) NOT NULL DEFAULT 'MANUAL'");

    // Ensure OrderId column exists in CashDrawerLog
    await runQuery("CashDrawerLog - OrderId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'OrderId') ALTER TABLE [dbo].[CashDrawerLog] ADD [OrderId] NVARCHAR(100) NULL");

    // Ensure LogId column exists in CashDrawerLog
    await runQuery("CashDrawerLog - LogId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'LogId') ALTER TABLE [dbo].[CashDrawerLog] ADD [LogId] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID()");

    // Ensure OutletId column exists in CashDrawerLog
    await runQuery("CashDrawerLog - OutletId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'OutletId') ALTER TABLE [dbo].[CashDrawerLog] ADD [OutletId] INT NOT NULL DEFAULT 1");

    // Ensure ActionType column exists in CashDrawerLog
    await runQuery("CashDrawerLog - ActionType", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'ActionType') ALTER TABLE [dbo].[CashDrawerLog] ADD [ActionType] NVARCHAR(30) NULL");

    // Ensure Amount column exists in CashDrawerLog
    await runQuery("CashDrawerLog - Amount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'Amount') ALTER TABLE [dbo].[CashDrawerLog] ADD [Amount] DECIMAL(18, 2) NULL");

    // Ensure TenderedAmount column exists in CashDrawerLog
    await runQuery("CashDrawerLog - TenderedAmount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'TenderedAmount') ALTER TABLE [dbo].[CashDrawerLog] ADD [TenderedAmount] DECIMAL(18, 2) NULL");

    // Ensure ChangeAmount column exists in CashDrawerLog
    await runQuery("CashDrawerLog - ChangeAmount", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'ChangeAmount') ALTER TABLE [dbo].[CashDrawerLog] ADD [ChangeAmount] DECIMAL(18, 2) NULL");

    // Ensure Reason column exists in CashDrawerLog
    await runQuery("CashDrawerLog - Reason", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'Reason') ALTER TABLE [dbo].[CashDrawerLog] ADD [Reason] NVARCHAR(100) NULL");

    // Ensure Remark column exists in CashDrawerLog
    await runQuery("CashDrawerLog - Remark", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'Remark') ALTER TABLE [dbo].[CashDrawerLog] ADD [Remark] NVARCHAR(500) NULL");

    // Ensure OpenedByUserId column exists in CashDrawerLog
    await runQuery("CashDrawerLog - OpenedByUserId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'OpenedByUserId') ALTER TABLE [dbo].[CashDrawerLog] ADD [OpenedByUserId] NVARCHAR(100) NULL");

    // Ensure ApprovedByUserId column exists in CashDrawerLog
    await runQuery("CashDrawerLog - ApprovedByUserId", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'ApprovedByUserId') ALTER TABLE [dbo].[CashDrawerLog] ADD [ApprovedByUserId] NVARCHAR(100) NULL");

    // Ensure IsSuccess column exists in CashDrawerLog
    await runQuery("CashDrawerLog - IsSuccess", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CashDrawerLog]') AND name = 'IsSuccess') ALTER TABLE [dbo].[CashDrawerLog] ADD [IsSuccess] BIT NOT NULL DEFAULT 1");

    // 22.1 Create Unique Filtered Index for SALE OrderIds (3-Layer Protection Layer 3)
    await runQuery("Index - CashDrawerLog Unique OrderId Sale", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UIX_CashDrawerLog_OrderId_Sale' AND object_id = OBJECT_ID('CashDrawerLog'))
      BEGIN
          CREATE UNIQUE NONCLUSTERED INDEX UIX_CashDrawerLog_OrderId_Sale 
          ON [dbo].[CashDrawerLog](OrderId) 
          WHERE OrderId IS NOT NULL AND OrderId <> '' AND OpenSource = 'SALE';
      END
    `);

    // 23. Create PrintJobQueue table for Print Bridge
    await runQuery("Create PrintJobQueue table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PrintJobQueue]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[PrintJobQueue](
              [JobId] UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
              [StoreId] NVARCHAR(50) NOT NULL,
              [PrinterName] NVARCHAR(100) NULL,
              [PrinterIp] NVARCHAR(100) NOT NULL,
              [PrinterPort] INT NOT NULL DEFAULT 9100,
              [Content] NVARCHAR(MAX) NOT NULL,
              [Status] NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
              [ErrorMessage] NVARCHAR(MAX) NULL,
              [CreatedOn] DATETIME NOT NULL DEFAULT GETDATE(),
              [ProcessedOn] DATETIME NULL,
              [CompletedOn] DATETIME NULL,
              [Attempts] INT NOT NULL DEFAULT 0
          )
      END
    `);

    // Create index on StoreId and Status for efficient polling
    await runQuery("Index - PrintJobQueue StoreId Status", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PrintJobQueue_Store_Status' AND object_id = OBJECT_ID('PrintJobQueue'))
      BEGIN
          CREATE NONCLUSTERED INDEX IX_PrintJobQueue_Store_Status
          ON [dbo].[PrintJobQueue](StoreId, Status);
      END
    `);

    // 24. Create LoyaltyCustomer table
    await runQuery("Create LoyaltyCustomer table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LoyaltyCustomer]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[LoyaltyCustomer](
              [LoyaltyCustomerId] UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
              [Phone] NVARCHAR(50) NOT NULL UNIQUE,
              [Name] NVARCHAR(255) NULL,
              [VisitCount] INT NOT NULL DEFAULT 0,
              [TotalVisits] INT NOT NULL DEFAULT 0,
              [RewardsEarned] INT NOT NULL DEFAULT 0,
              [RewardsRedeemed] INT NOT NULL DEFAULT 0,
              [RewardPending] BIT NOT NULL DEFAULT 0,
              [CreatedOn] DATETIME DEFAULT GETDATE(),
              [LastVisitDate] DATETIME NULL
          );
      END
    `);

    // Create index on Phone for fast lookup
    await runQuery("Index - LoyaltyCustomer Phone", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_LoyaltyCustomer_Phone' AND object_id = OBJECT_ID('LoyaltyCustomer'))
      BEGIN
          CREATE UNIQUE NONCLUSTERED INDEX IX_LoyaltyCustomer_Phone
          ON [dbo].[LoyaltyCustomer](Phone);
      END
    `);

    // 25. Create LoyaltyVisit table
    await runQuery("Create LoyaltyVisit table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LoyaltyVisit]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[LoyaltyVisit](
              [LoyaltyVisitId] UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
              [LoyaltyCustomerId] UNIQUEIDENTIFIER FOREIGN KEY REFERENCES LoyaltyCustomer(LoyaltyCustomerId),
              [SettlementId] UNIQUEIDENTIFIER UNIQUE NOT NULL,
              [BillNo] NVARCHAR(50) NOT NULL,
              [VisitDate] DATETIME DEFAULT GETDATE(),
              [IsRewardVisit] BIT NOT NULL DEFAULT 0,
              [RewardDishId] UNIQUEIDENTIFIER NULL
          );
      END
    `);

    // Create index on SettlementId
    await runQuery("Index - LoyaltyVisit SettlementId", `
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_LoyaltyVisit_SettlementId' AND object_id = OBJECT_ID('LoyaltyVisit'))
      BEGIN
          CREATE UNIQUE NONCLUSTERED INDEX IX_LoyaltyVisit_SettlementId
          ON [dbo].[LoyaltyVisit](SettlementId);
      END
    `);

    // 26. Create PrintReport table
    await runQuery("Create PrintReport table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PrintReport]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[PrintReport](
              [ID] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
              [OrderId] [uniqueidentifier] NULL,
              [Ordernumber] [nvarchar](50) NULL,
              [PrintType] [int] NULL,
              [orderDate] [datetime] DEFAULT GETDATE()
          )
      END
    `);

    // 25.1. Loyalty tables schema/columns migrations (Phase 1)
    await runQuery("Migration - LoyaltyRule Type & PurchaseDishGroupId & RewardDishGroupId", `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LoyaltyRule]') AND type in (N'U'))
      BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[LoyaltyRule]') AND name = 'LoyaltyType')
          BEGIN
              ALTER TABLE [dbo].[LoyaltyRule] ADD [LoyaltyType] NVARCHAR(50) NOT NULL DEFAULT 'Dish';
          END

          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[LoyaltyRule]') AND name = 'PurchaseDishGroupId')
          BEGIN
              ALTER TABLE [dbo].[LoyaltyRule] ADD [PurchaseDishGroupId] UNIQUEIDENTIFIER NULL;
          END

          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[LoyaltyRule]') AND name = 'RewardDishGroupId')
          BEGIN
              ALTER TABLE [dbo].[LoyaltyRule] ADD [RewardDishGroupId] UNIQUEIDENTIFIER NULL;
          END

          -- 1. Drop DEFAULT constraints on PurchaseDishId or RewardDishId
          DECLARE @drop_defaults NVARCHAR(MAX) = '';
          SELECT @drop_defaults = @drop_defaults + 'ALTER TABLE [dbo].[LoyaltyRule] DROP CONSTRAINT [' + d.name + '];' + CHAR(13)
          FROM sys.default_constraints d
          JOIN sys.columns c ON d.parent_column_id = c.column_id AND d.parent_object_id = c.object_id
          WHERE d.parent_object_id = OBJECT_ID('[dbo].[LoyaltyRule]')
            AND c.name IN ('PurchaseDishId', 'RewardDishId');
          IF @drop_defaults <> '' EXEC sp_executesql @drop_defaults;

          -- 2. Drop Foreign Keys defined ON LoyaltyRule for PurchaseDishId or RewardDishId
          DECLARE @drop_fks NVARCHAR(MAX) = '';
          SELECT @drop_fks = @drop_fks + 'ALTER TABLE [dbo].[LoyaltyRule] DROP CONSTRAINT [' + fk.name + '];' + CHAR(13)
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
          WHERE fk.parent_object_id = OBJECT_ID('[dbo].[LoyaltyRule]')
            AND fkc.parent_column_id IN (
                SELECT column_id FROM sys.columns 
                WHERE object_id = OBJECT_ID('[dbo].[LoyaltyRule]') 
                  AND name IN ('PurchaseDishId', 'RewardDishId')
            );
          IF @drop_fks <> '' EXEC sp_executesql @drop_fks;

          -- 3. Drop Foreign Keys REFERENCING LoyaltyRule(PurchaseDishId/RewardDishId) from other tables
          DECLARE @drop_ref_fks NVARCHAR(MAX) = '';
          SELECT @drop_ref_fks = @drop_ref_fks + 'ALTER TABLE [' + OBJECT_SCHEMA_NAME(fk.parent_object_id) + '].[' + OBJECT_NAME(fk.parent_object_id) + '] DROP CONSTRAINT [' + fk.name + '];' + CHAR(13)
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
          WHERE fk.referenced_object_id = OBJECT_ID('[dbo].[LoyaltyRule]')
            AND fkc.referenced_column_id IN (
                SELECT column_id FROM sys.columns 
                WHERE object_id = OBJECT_ID('[dbo].[LoyaltyRule]') 
                  AND name IN ('PurchaseDishId', 'RewardDishId')
            );
          IF @drop_ref_fks <> '' EXEC sp_executesql @drop_ref_fks;

          -- 4. Drop Indexes referencing PurchaseDishId or RewardDishId
          DECLARE @drop_indexes NVARCHAR(MAX) = '';
          SELECT @drop_indexes = @drop_indexes + 'DROP INDEX [' + i.name + '] ON [dbo].[LoyaltyRule];' + CHAR(13)
          FROM sys.indexes i
          JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
          JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          WHERE i.object_id = OBJECT_ID('[dbo].[LoyaltyRule]')
            AND c.name IN ('PurchaseDishId', 'RewardDishId')
            AND i.is_primary_key = 0;
          IF @drop_indexes <> '' EXEC sp_executesql @drop_indexes;

          -- Drop old index first to allow changing the column to nullable
          IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_LoyaltyRule_ActivePurchaseDish' AND object_id = OBJECT_ID('[dbo].[LoyaltyRule]'))
          BEGIN
              DROP INDEX UX_LoyaltyRule_ActivePurchaseDish ON [dbo].[LoyaltyRule];
          END

          IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_LoyaltyRule_ActivePurchaseDishGroup' AND object_id = OBJECT_ID('[dbo].[LoyaltyRule]'))
          BEGIN
              DROP INDEX UX_LoyaltyRule_ActivePurchaseDishGroup ON [dbo].[LoyaltyRule];
          END

          -- Ensure PurchaseDishId is nullable
          ALTER TABLE [dbo].[LoyaltyRule] ALTER COLUMN [PurchaseDishId] UNIQUEIDENTIFIER NULL;

          -- Ensure RewardDishId is nullable
          ALTER TABLE [dbo].[LoyaltyRule] ALTER COLUMN [RewardDishId] UNIQUEIDENTIFIER NULL;

          -- Re-create filtered indexes to allow multiple NULL values
          IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_LoyaltyRule_ActivePurchaseDish' AND object_id = OBJECT_ID('[dbo].[LoyaltyRule]'))
          BEGIN
              CREATE UNIQUE NONCLUSTERED INDEX UX_LoyaltyRule_ActivePurchaseDish ON [dbo].[LoyaltyRule](PurchaseDishId) WHERE PurchaseDishId IS NOT NULL AND IsActive = 1;
          END

          IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_LoyaltyRule_ActivePurchaseDishGroup' AND object_id = OBJECT_ID('[dbo].[LoyaltyRule]'))
          BEGIN
              CREATE UNIQUE NONCLUSTERED INDEX UX_LoyaltyRule_ActivePurchaseDishGroup ON [dbo].[LoyaltyRule](PurchaseDishGroupId) WHERE PurchaseDishGroupId IS NOT NULL AND IsActive = 1;
          END
      END
    `);

    // 27. Combo Meal Schema Migration
    await runQuery("DishMaster - IsCombo", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[DishMaster]') AND name = 'IsCombo') ALTER TABLE [dbo].[DishMaster] ADD IsCombo BIT NOT NULL DEFAULT 0");
    await runQuery("PrintMaster - IsEnabled", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[PrintMaster]') AND name = 'IsEnabled') ALTER TABLE [dbo].[PrintMaster] ADD IsEnabled BIT NOT NULL DEFAULT 1");
    await runQuery("RestaurantOrderDetailCur - ComboDetailsJSON", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetailCur]') AND name = 'ComboDetailsJSON') ALTER TABLE [dbo].[RestaurantOrderDetailCur] ADD ComboDetailsJSON NVARCHAR(MAX) NULL");
    await runQuery("RestaurantOrderDetail - ComboDetailsJSON", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RestaurantOrderDetail]') AND name = 'ComboDetailsJSON') ALTER TABLE [dbo].[RestaurantOrderDetail] ADD ComboDetailsJSON NVARCHAR(MAX) NULL");
    await runQuery("SettlementItemDetail - ComboDetailsJSON", "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[SettlementItemDetail]') AND name = 'ComboDetailsJSON') ALTER TABLE [dbo].[SettlementItemDetail] ADD ComboDetailsJSON NVARCHAR(MAX) NULL");

    await runQuery("Create ComboGroupMaster", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ComboGroupMaster]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[ComboGroupMaster](
              [ComboGroupId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [ParentComboDishId] [uniqueidentifier] NOT NULL,
              [GroupName] [nvarchar](100) NOT NULL,
              [DisplayOrder] [int] NOT NULL DEFAULT 0,
              [MinSelection] [int] NOT NULL DEFAULT 1,
              [MaxSelection] [int] NOT NULL DEFAULT 1,
              [IsMultiSelect] [bit] NOT NULL DEFAULT 0,
              [IsActive] [bit] NOT NULL DEFAULT 1,
              [CreatedOn] [datetime] DEFAULT GETDATE()
          );
          CREATE NONCLUSTERED INDEX IX_ComboGroupMaster_ParentComboDishId ON [dbo].[ComboGroupMaster](ParentComboDishId);
      END
    `);

    await runQuery("Create ComboGroupDishMapping", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ComboGroupDishMapping]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[ComboGroupDishMapping](
              [MappingId] [uniqueidentifier] NOT NULL PRIMARY KEY DEFAULT NEWID(),
              [ComboGroupId] [uniqueidentifier] NOT NULL,
              [DishId] [uniqueidentifier] NOT NULL,
              [Surcharge] [decimal](18, 2) NOT NULL DEFAULT 0.00,
              [IsDefault] [bit] NOT NULL DEFAULT 0,
              [SortOrder] [int] NOT NULL DEFAULT 0,
              [StoreId] [uniqueidentifier] NULL,
              [IsActive] [bit] NOT NULL DEFAULT 1,
              [CreatedOn] [datetime] DEFAULT GETDATE()
          );
          CREATE NONCLUSTERED INDEX IX_ComboGroupDishMapping_ComboGroupId ON [dbo].[ComboGroupDishMapping](ComboGroupId);
      END
    `);

    // 29. Create NetsTerminalConfig table for NETS ECR II integration
    await runQuery("Create NetsTerminalConfig table", `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[NetsTerminalConfig]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[NetsTerminalConfig](
              [ConfigId] INT IDENTITY(1,1) PRIMARY KEY,
              [InterfaceMode] NVARCHAR(20) NOT NULL DEFAULT 'LAN',
              [TerminalIp] NVARCHAR(50) NOT NULL DEFAULT '192.168.9.38',
              [TerminalPort] INT NOT NULL DEFAULT 7500,
              [ComPort] NVARCHAR(20) NOT NULL DEFAULT 'COM1',
              [BaudRate] INT NOT NULL DEFAULT 9600,
              [CreditAcquirer] NVARCHAR(20) NOT NULL DEFAULT 'DBS',
              [ReceiptMode] NVARCHAR(50) NOT NULL DEFAULT 'POS_PRINT_RP',
              [OnlineTimeoutSec] INT NOT NULL DEFAULT 120,
              [OfflineTimeoutSec] INT NOT NULL DEFAULT 60,
              [LastUpdated] DATETIME NOT NULL DEFAULT GETDATE()
          );

          INSERT INTO [dbo].[NetsTerminalConfig] (
              InterfaceMode, TerminalIp, TerminalPort, ComPort, BaudRate,
              CreditAcquirer, ReceiptMode, OnlineTimeoutSec, OfflineTimeoutSec
          ) VALUES (
              'LAN', '192.168.9.38', 7500, 'COM1', 9600,
              'DBS', 'POS_PRINT_RP', 120, 60
          );
      END
    `);

    console.log("✅ Database schema and performance indexes are up to date. (Rewards & NETS active)");


    // 🔄 Auto-sync kitchens to PrintMaster on every startup
    await syncKitchensToPrintMaster(pool);

  } catch (err) {
    console.error("❌ initDB CRITICAL ERROR:", err.message);
  }
}

// ============================================================
// 🔄 AUTO-SYNC: Detect ALL active kitchens → ensure PrintMaster rows
// ============================================================
// KEY FIX: Categories with no KitchenTypeCode (like Lebanon) are now
// auto-assigned a new unique code in CategoryKitchenType, then given
// their own PrintMaster row. No kitchen is ever missed or deduplicated.
// Runs on startup + every 3 minutes via server.js.
// ============================================================
async function syncKitchensToPrintMaster(pool) {
  try {
    // --- 0. DEDUP: Remove duplicate PrintMaster rows on every startup ---
    // Duplicates share the same KitchenTypeName but got different KitchenTypeValue codes
    // over multiple server restarts. Keep the BEST row per (PrinterType, KitchenTypeName):
    //   • Prefer rows where PrinterIP is non-empty (so configured IPs are preserved)
    //   • Among ties, keep the lowest KitchenTypeValue (the original assignment)
    const dedupResult = await pool.request().query(`
      WITH Ranked AS (
        SELECT PrinterId, PrinterType, KitchenTypeName, KitchenTypeValue,
               ROW_NUMBER() OVER (
                 PARTITION BY PrinterType, KitchenTypeName
                 ORDER BY
                   CASE WHEN ISNULL(PrinterIP,'') <> '' THEN 0 ELSE 1 END,
                   KitchenTypeValue ASC,
                   PrinterId
               ) AS rn
        FROM PrintMaster
      )
      DELETE FROM PrintMaster
      WHERE PrinterId IN (SELECT PrinterId FROM Ranked WHERE rn > 1)
    `);
    const deleted = dedupResult.rowsAffected?.[0] ?? 0;
    if (deleted > 0) {
      console.log(`🧹 [KitchenSync] Removed ${deleted} duplicate PrintMaster row(s).`);
    }

    // --- 0b. Realign CategoryKitchenType codes to match surviving PrintMaster rows ---
    // After dedup the surviving row may have a different KitchenTypeValue than what
    // CategoryKitchenType stores, which would cause the sync to keep re-inserting rows.
    await pool.request().query(`
      UPDATE ckt
      SET ckt.KitchenTypeCode = CAST(pm.KitchenTypeValue AS NVARCHAR(50))
      FROM CategoryKitchenType ckt
      JOIN CategoryMaster cm ON ckt.CategoryId = cm.CategoryId
      JOIN PrintMaster pm ON pm.KitchenTypeName = cm.CategoryName AND pm.PrinterType = 2
      WHERE ckt.KitchenTypeCode IS NOT NULL
        AND CAST(ckt.KitchenTypeCode AS INT) <> pm.KitchenTypeValue
    `);
    // --- 1. Ensure default Cashier Printer (PrinterType = 1) ---
    const cashierCheck = await pool.request()
      .query("SELECT COUNT(*) as cnt FROM PrintMaster WHERE PrinterType = 1 AND IsActive = 1");
    if (cashierCheck.recordset[0].cnt === 0) {
      let defaultIP = "192.168.0.20";
      try {
        const cs = await pool.request().query("SELECT TOP 1 PrinterIP FROM CompanySettings WHERE PrinterIP IS NOT NULL AND PrinterIP <> ''");
        if (cs.recordset[0]?.PrinterIP) defaultIP = cs.recordset[0].PrinterIP;
      } catch (_) { }
      await pool.request()
        .input("ip", sql.NVarChar, defaultIP)
        .query(`
          INSERT INTO PrintMaster (PrinterId, PrinterName, PrinterPath, PrinterIP, PrinterType, PrintSection, KitchenTypeName, KitchenTypeValue, IsActive, PrintCopy)
          VALUES (NEWID(), 'Receipt Printer', @ip, @ip, 1, 1, 'Receipt Print', 0, 1, 1)
        `);
      console.log("🛠️ [KitchenSync] Auto-created default Cashier Printer in PrintMaster.");
    }

    // --- 2. Ensure default TakeAway Printer (PrinterType = 3) ---
    const taCheck = await pool.request()
      .query("SELECT COUNT(*) as cnt FROM PrintMaster WHERE PrinterType = 3 AND IsActive = 1");
    if (taCheck.recordset[0].cnt === 0) {
      // Find a safe code for TakeAway that doesn't clash with kitchen codes
      const maxCodeRes = await pool.request().query("SELECT ISNULL(MAX(KitchenTypeValue), 0) + 1 AS nextCode FROM PrintMaster WHERE PrinterType IN (2, 3)");
      const taCode = maxCodeRes.recordset[0].nextCode;
      await pool.request()
        .input("code", sql.Int, taCode)
        .query(`
          INSERT INTO PrintMaster (PrinterId, PrinterName, PrinterPath, PrinterIP, PrinterType, PrintSection, KitchenTypeName, KitchenTypeValue, IsActive, PrintCopy)
          VALUES (NEWID(), 'TakeAway', '192.168.0.20', '192.168.0.20', 3, 1, 'TakeAway', @code, 1, 1)
        `);
      console.log("🛠️ [KitchenSync] Auto-created default TakeAway Printer in PrintMaster.");
    }

    // --- 3. Fetch ALL active categories with their current KitchenTypeCode ---
    const activeCatsResult = await pool.request().query(`
      SELECT
        cm.CategoryId,
        cm.CategoryName AS KitchenTypeName,
        ckt.KitchenTypeCode
      FROM CategoryMaster cm
      LEFT JOIN CategoryKitchenType ckt ON cm.CategoryId = ckt.CategoryId
      WHERE cm.IsActive = 1
        AND cm.CategoryName IS NOT NULL
        AND cm.CategoryName <> ''
        AND cm.CategoryName NOT LIKE '%TEST%'
    `);
    const activeCats = activeCatsResult.recordset;

    // --- 4. Get all codes currently used across ALL PrintMaster rows (any type)
    //        to avoid assigning a new code that clashes with something already there ---
    const allCodesRes = await pool.request().query("SELECT KitchenTypeValue FROM PrintMaster");
    const allUsedCodes = new Set(allCodesRes.recordset.map(r => r.KitchenTypeValue));

    // --- 5. For categories with NO KitchenTypeCode → auto-assign a fresh unique code
    //        and insert into CategoryKitchenType so routing works ---
    let nextCode = Math.max(...Array.from(allUsedCodes), 0) + 1;

    for (const cat of activeCats) {
      if (cat.KitchenTypeCode === null || cat.KitchenTypeCode === undefined || cat.KitchenTypeCode === '') {
        // Pick next available code not already in use
        while (allUsedCodes.has(nextCode)) nextCode++;

        console.log(`🔧 [KitchenSync] Assigning new code ${nextCode} to kitchen "${cat.KitchenTypeName}" (CategoryId=${cat.CategoryId})`);

        // Check if a row already exists in CategoryKitchenType for this CategoryId
        const existsCKT = await pool.request()
          .input("catId", sql.UniqueIdentifier, cat.CategoryId)
          .query("SELECT COUNT(*) as cnt FROM CategoryKitchenType WHERE CategoryId = @catId");

        if (existsCKT.recordset[0].cnt === 0) {
          // Insert new mapping row
          await pool.request()
            .input("catId", sql.UniqueIdentifier, cat.CategoryId)
            .input("code", sql.NVarChar, String(nextCode))
            .input("name", sql.NVarChar, cat.KitchenTypeName)
            .query(`
              INSERT INTO CategoryKitchenType (CategoryId, KitchenTypeCode, KitchenTypeName)
              VALUES (@catId, @code, @name)
            `);
        } else {
          // Update existing row that has null code
          await pool.request()
            .input("catId", sql.UniqueIdentifier, cat.CategoryId)
            .input("code", sql.NVarChar, String(nextCode))
            .query(`
              UPDATE CategoryKitchenType SET KitchenTypeCode = @code
              WHERE CategoryId = @catId AND (KitchenTypeCode IS NULL OR KitchenTypeCode = '')
            `);
        }

        // Mark this code as used and advance
        cat.KitchenTypeCode = String(nextCode);
        allUsedCodes.add(nextCode);
        nextCode++;
      }
    }

    // --- 6. Now build a deduplicated map of code → name from the updated category list ---
    const kitchenMap = new Map(); // code (int) → name
    for (const cat of activeCats) {
      const code = parseInt(cat.KitchenTypeCode);
      if (!isNaN(code) && !kitchenMap.has(code)) {
        kitchenMap.set(code, cat.KitchenTypeName);
      }
    }

    // --- 7. Fetch existing kitchen printers (PrinterType=2) from PrintMaster ---
    const existingResult = await pool.request().query(
      "SELECT KitchenTypeValue, IsActive FROM PrintMaster WHERE PrinterType = 2"
    );
    const existingMap = new Map(existingResult.recordset.map(r => [r.KitchenTypeValue, r.IsActive]));

    // --- 8. Insert missing / reactivate soft-deleted kitchen printers ---
    let inserted = 0;
    let reactivated = 0;
    for (const [code, name] of kitchenMap) {
      if (!existingMap.has(code)) {
        // Brand new — insert with empty IP (admin fills it in Receipt Settings)
        await pool.request()
          .input("name", sql.NVarChar, name)
          .input("code", sql.Int, code)
          .query(`
            INSERT INTO PrintMaster (
              PrinterId, PrinterName, PrinterPath, PrinterIP,
              PrinterType, PrintSection, KitchenTypeName,
              KitchenTypeValue, IsActive, PrintCopy
            ) VALUES (
              NEWID(), @name, '', '',
              2, 1, @name,
              @code, 1, 1
            )
          `);
        inserted++;
        console.log(`🍳 [KitchenSync] Auto-added "${name}" to PrintMaster (code=${code})`);
      }
    }

    if (inserted === 0 && reactivated === 0) {
      console.log(`✅ [KitchenSync] All ${kitchenMap.size} active kitchen(s) already in PrintMaster. No changes needed.`);
    } else {
      console.log(`✅ [KitchenSync] Done. Inserted: ${inserted}, Reactivated: ${reactivated}`);
    }
  } catch (err) {
    console.error("❌ [KitchenSync] Failed:", err.message);
  }
}

module.exports = { initDB, syncKitchensToPrintMaster };
