SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report07QuotaMap
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        OrgUnitNo,
        SUM(ISNULL(L9907, 0)) AS q_1,
        SUM(ISNULL(L9906, 0)) AS q_2,
        SUM(ISNULL(L9905, 0)) AS q_3,
        SUM(ISNULL(L9904, 0)) AS q_4,
        SUM(ISNULL(L9903, 0)) AS q_5,
        SUM(ISNULL(L9902, 0)) AS q_6,
        SUM(ISNULL(L9901, 0)) AS q_7,
        SUM(ISNULL(L9907, 0) + ISNULL(L9906, 0) + ISNULL(L9905, 0) + ISNULL(L9904, 0)
            + ISNULL(L9903, 0) + ISNULL(L9902, 0) + ISNULL(L9901, 0)) AS q_total,
        SUM(ISNULL(L9908, 0)) AS q_8,
        SUM(ISNULL(L9910, 0)) AS q_10
    FROM dbo.MP_QuotaN
    WHERE EffectiveDate = DATEADD(month, DATEDIFF(month, 0, @EffectiveDate), 0)
    GROUP BY OrgUnitNo;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_BGNamesByEffectiveDate
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        BGNo,
        BGName
    FROM dbo.MP_BG
    WHERE @EffectiveDate BETWEEN BeginDate AND EndDate;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report07LandscapeContext
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    WITH ranked AS (
        SELECT
            OrgUnitNo,
            CAST(vp AS decimal(18,4)) AS vp,
            CAST(dm AS decimal(18,4)) AS dm,
            CAST(sr AS decimal(18,4)) AS sr,
            CAST(jr AS decimal(18,4)) AS jr,
            BeginDate,
            EndDate,
            ROW_NUMBER() OVER (
                PARTITION BY OrgUnitNo
                ORDER BY BeginDate DESC, EndDate DESC
            ) AS rn
        FROM dbo.MP_Landscape
        WHERE @EffectiveDate BETWEEN BeginDate AND EndDate
    )
    SELECT
        OrgUnitNo,
        vp,
        dm,
        sr,
        jr
    FROM ranked
    WHERE rn = 1;
END;
GO
