SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report08PositionMap
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        CAST(OrgUnitID AS nvarchar(32)) AS org_unit_no,
        CAST(LevelGroupNo AS nvarchar(16)) AS level_group_no,
        COUNT(1) AS metric_value
    FROM dbo.InterfacePosition
    WHERE CAST(LevelGroupNo AS nvarchar(16)) IN (
        N'1007',
        N'1006',
        N'1005',
        N'1004',
        N'1003',
        N'1002',
        N'1001'
    )
      AND @EffectiveDate BETWEEN COALESCE(BeginDate, @EffectiveDate) AND COALESCE(EndDate, @EffectiveDate)
      AND EmployeeID IS NOT NULL
      AND LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(50)))) <> ''
      AND TRY_CONVERT(int, SignPos) = 100
    GROUP BY
        CAST(OrgUnitID AS nvarchar(32)),
        CAST(LevelGroupNo AS nvarchar(16));
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report08CostMap
    @FromDate datetime,
    @ToDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        CAST(OrgUnitNo AS nvarchar(32)) AS org_unit_no,
        CAST(LevelGroupNo AS nvarchar(16)) AS level_group_no,
        SUM(COALESCE(TRY_CONVERT(decimal(18,2), TotalCost), 0)) AS metric_value
    FROM dbo.MP_CostEmployee
    WHERE CAST(LevelGroupNo AS nvarchar(16)) IN (
        N'1007',
        N'1006',
        N'1005',
        N'1004',
        N'1003',
        N'1002',
        N'1001',
        N'1017',
        N'1018'
    )
      AND EffectiveDate BETWEEN @FromDate AND @ToDate
    GROUP BY
        CAST(OrgUnitNo AS nvarchar(32)),
        CAST(LevelGroupNo AS nvarchar(16));
END;
GO
