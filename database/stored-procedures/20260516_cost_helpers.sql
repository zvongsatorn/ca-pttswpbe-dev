SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_CostLevelGroupOptions
    @EffectiveDate date
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo,
        LTRIM(RTRIM(CAST(LevelGroupName AS nvarchar(255)))) AS LevelGroupName,
        TRY_CONVERT(int, LevelGroupOrder) AS LevelGroupOrder
    FROM dbo.MP_LevelGroup
    WHERE
        @EffectiveDate BETWEEN
        COALESCE(TRY_CONVERT(date, BeginDate), @EffectiveDate) AND
        COALESCE(TRY_CONVERT(date, EndDate), @EffectiveDate)
    ORDER BY
        COALESCE(TRY_CONVERT(int, LevelGroupOrder), 9999),
        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16))));
END;
GO
