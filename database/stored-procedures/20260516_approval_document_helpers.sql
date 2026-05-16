SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_ApproveHistBySeqGet
    @ApproveID decimal(18, 0),
    @Seqno int
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        FNAME,
        LNAME,
        EmailAddr,
        REP_CODE
    FROM dbo.MP_ApproveHist
    WHERE ApproveID = @ApproveID
      AND Seqno = @Seqno;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DocumentRequesterGet
    @DocumentNo varchar(13),
    @ItemID varchar(10)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        EmployeeID,
        Fullname,
        Email
    FROM dbo.MP_DocumentItems WITH (NOLOCK)
    WHERE DocumentNo = @DocumentNo
      AND ItemID = @ItemID
      AND Seqno = 0;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_TransactionsEffectiveDatesByNos
    @TransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        TransactionNo,
        EffectiveDate
    FROM dbo.MP_Transactions WITH (NOLOCK)
    WHERE TransactionNo IN (
        SELECT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@TransactionNosCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    )
      AND EffectiveDate IS NOT NULL;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_TransactionUnitGet
    @TransactionNo varchar(10)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        UnitReceive,
        UnitTransfer
    FROM dbo.MP_Transactions WITH (NOLOCK)
    WHERE TransactionNo = @TransactionNo;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_TransactionLookupByNos
    @TransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        TransactionNo,
        TransactionType,
        TransactionDesc
    FROM dbo.MP_Transactions WITH (NOLOCK)
    WHERE TransactionNo IN (
        SELECT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@TransactionNosCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_TransactionStatusGet
    @TransactionNo varchar(10)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        Status
    FROM dbo.MP_Transactions WITH (NOLOCK)
    WHERE TransactionNo = @TransactionNo;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DocumentMyActiveApprovalsGet
    @DocumentNo varchar(13),
    @EmployeeID varchar(20)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        ItemID,
        Seqno,
        EmployeeID,
        AuditStatus,
        UnitSide
    FROM dbo.MP_DocumentItems WITH (NOLOCK)
    WHERE DocumentNo = @DocumentNo
      AND EmployeeID = @EmployeeID
      AND AuditStatus = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DocumentItemIdsGet
    @DocumentNo varchar(13)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DISTINCT
        ItemID
    FROM dbo.MP_DocumentItems
    WHERE DocumentNo = @DocumentNo;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DocumentPendingSeqGet
    @DocumentNo varchar(13),
    @ItemID varchar(10),
    @UpdateBy varchar(20)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        Seqno
    FROM dbo.MP_DocumentItems WITH (NOLOCK)
    WHERE DocumentNo = @DocumentNo
      AND ItemID = @ItemID
      AND AuditStatus IN (0, 1)
    ORDER BY
      CASE
        WHEN AuditStatus = 1 AND EmployeeID = @UpdateBy THEN 0
        WHEN AuditStatus = 1 THEN 1
        ELSE 2
      END,
      Seqno ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DocumentProgressLogsQuery
    @DocumentNo varchar(13)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DISTINCT
        di.Seqno,
        di.EmployeeID,
        di.Fullname,
        di.AuditStatus,
        di.AuditDate,
        di.UserGroupNo,
        di.UnitSide,
        ug.UserGroupName
    FROM dbo.MP_DocumentItems AS di
    LEFT JOIN dbo.MP_UserGroup AS ug
        ON di.UserGroupNo = ug.UserGroupNo
    WHERE di.DocumentNo = @DocumentNo
    ORDER BY di.Seqno ASC;
END;
GO
