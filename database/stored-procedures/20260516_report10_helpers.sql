SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report10ExportData
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH LevelMap AS (
        SELECT N'1007' AS LevelCode, N'ปธบ./กผญ.' AS LevelName, 1 AS SortOrder UNION ALL
        SELECT N'1006', N'ประธานเจ้าหน้าที่/รองกรรมการผู้จัดการใหญ่', 2 UNION ALL
        SELECT N'1005', N'ผู้ช่วยกรรมการผู้จัดการใหญ่', 3 UNION ALL
        SELECT N'1004', N'ผู้จัดการฝ่าย', 4
    ),
    PositionSource AS (
        SELECT p.*
        FROM dbo.fn_InterfacePosition(@EffectiveDate) AS p
        INNER JOIN LevelMap AS lm
            ON lm.LevelCode = LTRIM(RTRIM(CAST(p.LevelGroupNo AS nvarchar(16))))
        WHERE @EffectiveDate BETWEEN TRY_CONVERT(date, p.BeginDate) AND TRY_CONVERT(date, p.EndDate)
    ),
    InfoDataByPosition AS (
        SELECT
            i.*,
            ROW_NUMBER() OVER (
                PARTITION BY i.POSCODE
                ORDER BY
                    CAST(i.CODE AS nvarchar(32)) DESC,
                    CAST(i.FULLNAMETH AS nvarchar(300)) DESC
            ) AS rn
        FROM dbo.InfoData AS i
    ),
    InfoDataByPositionEmployee AS (
        SELECT
            i.*,
            ROW_NUMBER() OVER (
                PARTITION BY i.POSCODE, i.CODE
                ORDER BY
                    CAST(i.FULLNAMETH AS nvarchar(300)) DESC
            ) AS rn
        FROM dbo.InfoData AS i
    ),
    JCodeDedup AS (
        SELECT
            levelgroup,
            MAX(JCODE) AS JCODE
        FROM dbo.mp_JCode
        GROUP BY levelgroup
    )
    SELECT
        COALESCE(iEmployee.POSCODE, iPosition.POSCODE, p.PositionID) AS POSCODE,
        p.OrgUnitID AS OrgUnitNo,
        InterfaceUnit.UnitName,
        p.OrgFlag,
        p.OrgType,
        p.PoolRSFlag,
        p.JobBand,
        p.LevelGroupNo,
        p.SignPos,
        p.StrgFlag,
        p.BSType,
        p.SpecFlag,
        p.LineStaffFlag,
        p.EmployeeID,
        COALESCE(iEmployee.CODE, iPosition.CODE) AS InfoEmployeeID,
        COALESCE(iEmployee.FULLNAMETH, iPosition.FULLNAMETH) AS FULLNAMETH,
        COALESCE(iEmployee.POSNAME, iPosition.POSNAME) AS POSNAME,
        JCodeDedup.JCODE,
        LevelMap.LevelCode,
        LevelMap.LevelName,
        LevelMap.SortOrder,
        InterfaceUnit.ParentOrgUnitNo,
        UnitParent.UnitName AS ParentUnitName
    FROM PositionSource AS p
    LEFT JOIN InfoDataByPositionEmployee AS iEmployee
        ON iEmployee.POSCODE = p.PositionID
       AND iEmployee.CODE = p.EmployeeID
       AND iEmployee.rn = 1
    LEFT JOIN InfoDataByPosition AS iPosition
        ON iPosition.POSCODE = p.PositionID
       AND iPosition.rn = 1
    LEFT JOIN JCodeDedup
        ON JCodeDedup.levelgroup = p.LevelGroupNo
    LEFT JOIN LevelMap
        ON LevelMap.LevelCode = LTRIM(RTRIM(CAST(p.LevelGroupNo AS nvarchar(16))))
    LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS InterfaceUnit
        ON InterfaceUnit.OrgUnitNo = p.OrgUnitID
    LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS UnitParent
        ON UnitParent.OrgUnitNo = InterfaceUnit.ParentOrgUnitNo;
END;
GO
