SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_ProcedureParameterExists
    @SpecificName nvarchar(128),
    @ParameterName nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        1 AS ExistsFlag
    FROM INFORMATION_SCHEMA.PARAMETERS
    WHERE SPECIFIC_SCHEMA = 'dbo'
      AND SPECIFIC_NAME = @SpecificName
      AND PARAMETER_NAME = @ParameterName;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_ApprovedRemarkForUnitInMonthExists
    @EffectiveDate date,
    @UnitReceive varchar(8)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        t.TransactionNo
    FROM dbo.MP_Transactions AS t WITH (NOLOCK)
    WHERE t.TransactionType = 5
      AND ISNULL(t.Status, 0) = 3
      AND CONVERT(date, t.EffectiveDate) = @EffectiveDate
      AND ISNULL(LTRIM(RTRIM(t.UnitReceive)), '') = @UnitReceive;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DirectApproveTransactionsLookup
    @TransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        t.TransactionNo,
        t.EffectiveDate,
        t.TransactionType,
        t.RefTransactionNo,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM dbo.MP_DocumentItems AS di WITH (NOLOCK)
                WHERE di.ItemID = t.TransactionNo
            ) THEN 1
            ELSE 0
        END AS HasDocument
    FROM dbo.MP_Transactions AS t WITH (NOLOCK)
    WHERE t.TransactionNo IN (
        SELECT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@TransactionNosCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_ReturnParentDocumentsLookup
    @ReturnTransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        t.TransactionNo,
        dBorrow.DocumentNo AS ParentDocumentNo
    FROM dbo.MP_Transactions AS t WITH (NOLOCK)
    LEFT JOIN dbo.MP_DocumentItems AS diBorrow WITH (NOLOCK)
        ON diBorrow.ItemID = t.RefTransactionNo
    LEFT JOIN dbo.MP_Document AS dBorrow WITH (NOLOCK)
        ON dBorrow.DocumentNo = diBorrow.DocumentNo
    WHERE t.TransactionNo IN (
        SELECT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@ReturnTransactionNosCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_ReturnedAmountByBorrowTransactions
    @BorrowTransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        RefTransactionNo,
        SUM(CAST(ISNULL(Amount, 0) AS int)) AS ReturnedAmount
    FROM dbo.MP_Transactions WITH (NOLOCK)
    WHERE TransactionType = 7
      AND Status IN (1, 2, 3)
      AND RefTransactionNo IN (
          SELECT LTRIM(RTRIM(value))
          FROM STRING_SPLIT(@BorrowTransactionNosCsv, ',')
          WHERE LTRIM(RTRIM(value)) <> ''
      )
    GROUP BY RefTransactionNo;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_ReturnTransactionDetailsByNos
    @ReturnTransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        t.TransactionNo,
        t.EffectiveDate,
        t.TransactionDesc,
        t.UnitReceive,
        t.UnitTransfer,
        t.PoolRsFlag,
        t.StrgFlag,
        t.BSType,
        t.SpecFlag,
        t.LineStaffFlag
    FROM dbo.MP_Transactions AS t WITH (NOLOCK)
    WHERE t.TransactionNo IN (
        SELECT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@ReturnTransactionNosCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    );
END;
GO
