SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_MenuNameGet
    @MenuID int
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        MenuName
    FROM dbo.MP_Menu
    WHERE MenuID = @MenuID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_SendSapResetStatusForTransactions
    @TransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    WITH TargetSendSap AS (
        SELECT DISTINCT
            CAST(t.EffectiveDate AS date) AS EffectiveDate,
            LTRIM(RTRIM(t.UnitReceive)) AS OrgUnitNo
        FROM dbo.MP_Transactions AS t WITH (NOLOCK)
        WHERE t.TransactionNo IN (
            SELECT LTRIM(RTRIM(value))
            FROM STRING_SPLIT(@TransactionNosCsv, ',')
            WHERE LTRIM(RTRIM(value)) <> ''
        )
          AND NULLIF(LTRIM(RTRIM(t.UnitReceive)), '') IS NOT NULL
    )
    UPDATE sap
    SET sap.SendSapStatus = 1
    FROM dbo.MP_SendSap AS sap
    INNER JOIN TargetSendSap AS target
        ON CAST(sap.EffectiveDate AS date) = target.EffectiveDate
       AND LTRIM(RTRIM(sap.OrgUnitNo)) = target.OrgUnitNo
    WHERE sap.SendSapStatus = 2;
END;
GO
