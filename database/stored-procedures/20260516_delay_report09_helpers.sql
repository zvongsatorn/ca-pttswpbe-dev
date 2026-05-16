SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayGetById
    @DelayID varchar(18)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        CAST(DelayID AS varchar(18)) AS DelayID,
        LTRIM(RTRIM(CAST(EmployeeID AS varchar(20)))) AS EmployeeID,
        LTRIM(RTRIM(COALESCE(PosName, ''))) AS PosName,
        CAST(RetirementYear AS int) AS RetirementYear,
        CAST(DelayYear AS int) AS DelayYear,
        CAST(DelayStatus AS int) AS DelayStatus,
        CAST(DelayType AS int) AS DelayType
    FROM dbo.MP_Delay
    WHERE CAST(DelayID AS varchar(18)) = @DelayID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report09YearRates
    @EffectiveYear int,
    @FromYear int,
    @ToYear int
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @EffectiveYearAD int = CASE WHEN @EffectiveYear > 2500 THEN @EffectiveYear - 543 ELSE @EffectiveYear END;
    DECLARE @EffectiveYearBE int = @EffectiveYearAD + 543;

    ;WITH DisplayYears AS (
        SELECT @FromYear AS DisplayYear
        UNION ALL
        SELECT DisplayYear + 1
        FROM DisplayYears
        WHERE DisplayYear < @ToYear
    ),
    QueryYears AS (
        SELECT DisplayYear AS QueryYear
        FROM DisplayYears
        UNION
        SELECT CASE WHEN DisplayYear > 2500 THEN DisplayYear - 543 ELSE DisplayYear + 543 END AS QueryYear
        FROM DisplayYears
    )
    SELECT
        TRY_CONVERT(int, r.[Year]) AS [Year],
        TRY_CONVERT(int, r.TypeRate) AS TypeRate,
        TRY_CONVERT(int, r.Rate) AS Rate,
        TRY_CONVERT(int, r.Base) AS Base
    FROM dbo.MP_BUSupportRate AS r
    INNER JOIN QueryYears AS y
        ON TRY_CONVERT(int, r.[Year]) = y.QueryYear
    WHERE r.EffectiveYear IN (@EffectiveYearAD, @EffectiveYearBE)
      AND ISNULL(TRY_CONVERT(int, r.BUSupportRateStatus), 1) = 1
    OPTION (MAXRECURSION 100);
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report09MissingStructureUnits
    @EffectiveDate datetime,
    @OrgUnitIdsCsv nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target_ids AS (
        SELECT DISTINCT LTRIM(RTRIM(value)) AS OrgUnitNo
        FROM STRING_SPLIT(@OrgUnitIdsCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    )
    SELECT
        unit.OrgUnitNo,
        unit.UnitAbbr,
        unit.UnitName,
        unit.ParentOrgUnitNo,
        unit.GroupBG,
        bg.BGName,
        unit.IsBelongTo
    FROM dbo.fn_InterfaceUnit(@EffectiveDate) AS unit
    INNER JOIN target_ids AS target
        ON target.OrgUnitNo = LTRIM(RTRIM(CAST(unit.OrgUnitNo AS nvarchar(32))))
    LEFT JOIN dbo.MP_BG AS bg
        ON bg.BGNo = unit.BGNo
       AND @EffectiveDate BETWEEN bg.BeginDate AND bg.EndDate;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report09UnitParentMap
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        unit.OrgUnitNo,
        unit.ParentOrgUnitNo
    FROM dbo.fn_InterfaceUnit(@EffectiveDate) AS unit;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayList
    @SelectedYear int = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        CAST(DelayID AS varchar(18)) AS DelayID,
        LTRIM(RTRIM(CAST(EmployeeID AS varchar(20)))) AS EmployeeID,
        LTRIM(RTRIM(COALESCE(PosName, ''))) AS PosName,
        CAST(RetirementYear AS int) AS RetirementYear,
        CAST(DelayYear AS int) AS DelayYear,
        CAST(DelayStatus AS int) AS DelayStatus,
        CAST(DelayType AS int) AS DelayType
    FROM dbo.MP_Delay
    WHERE ISNULL(DelayStatus, 1) = 1
      AND (@SelectedYear IS NULL OR RetirementYear = @SelectedYear)
    ORDER BY
        RetirementYear DESC,
        DelayYear DESC,
        EmployeeID ASC,
        DelayID ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayCreate
    @EmployeeID varchar(8),
    @PosName varchar(100),
    @RetirementYear int = NULL,
    @DelayYear int,
    @DelayStatus int,
    @DelayType int = NULL,
    @UserID varchar(10),
    @Now datetime
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.MP_Delay (
        EmployeeID,
        PosName,
        RetirementYear,
        DelayYear,
        DelayStatus,
        DelayType,
        CreateBy,
        CreateDate
    )
    VALUES (
        @EmployeeID,
        @PosName,
        @RetirementYear,
        @DelayYear,
        @DelayStatus,
        @DelayType,
        @UserID,
        @Now
    );

    SELECT CAST(SCOPE_IDENTITY() AS varchar(18)) AS DelayID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayUpdate
    @DelayID varchar(18),
    @EmployeeID varchar(8),
    @PosName varchar(100),
    @RetirementYear int = NULL,
    @DelayYear int,
    @DelayStatus int,
    @DelayType int = NULL,
    @UserID varchar(10),
    @Now datetime
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.MP_Delay
    SET
        EmployeeID = @EmployeeID,
        PosName = @PosName,
        RetirementYear = @RetirementYear,
        DelayYear = @DelayYear,
        DelayStatus = @DelayStatus,
        DelayType = @DelayType,
        UpdateBy = @UserID,
        UpdateDate = @Now
    WHERE CAST(DelayID AS varchar(18)) = @DelayID
      AND ISNULL(DelayStatus, 1) = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayDelete
    @DelayID varchar(18),
    @UserID varchar(10),
    @Now datetime
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.MP_Delay
    SET
        DelayStatus = 0,
        UpdateBy = @UserID,
        UpdateDate = @Now
    WHERE CAST(DelayID AS varchar(18)) = @DelayID
      AND ISNULL(DelayStatus, 1) = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayRetireYearOptionsFromInfoData
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DISTINCT
        TRY_CONVERT(int, i.RETIREYEAR) AS retire_year
    FROM dbo.InfoData AS i
    INNER JOIN dbo.fn_InterfacePosition(@EffectiveDate) AS p
        ON LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64)))) =
           LTRIM(RTRIM(CAST(i.POSCODE AS nvarchar(64))))
    WHERE TRY_CONVERT(int, p.SignPos) = 100
      AND TRY_CONVERT(int, i.RETIREYEAR) IS NOT NULL
    ORDER BY retire_year ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayRetireYearOptionsFromDelay
    @NonCountDelayYear int = 9999
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DISTINCT
        TRY_CONVERT(int, DelayYear) AS retire_year
    FROM dbo.MP_Delay
    WHERE TRY_CONVERT(int, DelayYear) IS NOT NULL
      AND TRY_CONVERT(int, DelayYear) <> @NonCountDelayYear
    ORDER BY retire_year ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayEmployeeNameMap
    @EmployeeIdsCsv nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target_ids AS (
        SELECT DISTINCT LTRIM(RTRIM(value)) AS employee_id
        FROM STRING_SPLIT(@EmployeeIdsCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    )
    SELECT
        src.employee_id,
        MAX(src.employee_name) AS employee_name
    FROM (
        SELECT
            LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32)))) AS employee_id,
            LTRIM(RTRIM(COALESCE(CAST(i.FULLNAMETH AS nvarchar(200)), N''))) AS employee_name
        FROM dbo.InfoData AS i
        INNER JOIN target_ids AS t
            ON t.employee_id = LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32))))
    ) AS src
    WHERE src.employee_id <> ''
      AND src.employee_name <> ''
    GROUP BY src.employee_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayEmployeePositionMap
    @EmployeeIdsCsv nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target_ids AS (
        SELECT DISTINCT LTRIM(RTRIM(value)) AS employee_id
        FROM STRING_SPLIT(@EmployeeIdsCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    )
    SELECT
        src.employee_id,
        MAX(src.pos_name) AS pos_name
    FROM (
        SELECT
            LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32)))) AS employee_id,
            LTRIM(RTRIM(COALESCE(CAST(i.POSNAME AS nvarchar(200)), N''))) AS pos_name
        FROM dbo.InfoData AS i
        INNER JOIN target_ids AS t
            ON t.employee_id = LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32))))
    ) AS src
    WHERE src.employee_id <> ''
      AND src.pos_name <> ''
    GROUP BY src.employee_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayEmployeeProfile
    @EmployeeID varchar(32),
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        TRY_CONVERT(int, i.RETIREYEAR) AS retire_year,
        NULLIF(LTRIM(RTRIM(CAST(i.POSNAME AS nvarchar(200)))), '') AS pos_name,
        CASE
            WHEN LTRIM(RTRIM(CAST(u.BGNo AS nvarchar(32)))) = N'905'
              OR UPPER(LTRIM(RTRIM(CAST(u.UnitName AS nvarchar(255))))) IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')
              OR UPPER(LTRIM(RTRIM(CAST(u.UnitAbbr AS nvarchar(255))))) = N'HO'
                THEN 2
            WHEN TRY_CONVERT(int, p.OrgType) = 2
             AND TRY_CONVERT(int, p.BSType) = 2
                THEN 2
            ELSE 1
        END AS delay_type
    FROM dbo.InfoData AS i
    INNER JOIN dbo.fn_InterfacePosition(@EffectiveDate) AS p
        ON LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64)))) =
           LTRIM(RTRIM(CAST(i.POSCODE AS nvarchar(64))))
    LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS u
        ON LTRIM(RTRIM(CAST(u.OrgUnitNo AS nvarchar(32)))) =
           LTRIM(RTRIM(CAST(p.OrgUnitID AS nvarchar(32))))
    WHERE TRY_CONVERT(int, p.SignPos) = 100
      AND (
            LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32)))) = @EmployeeID
         OR LTRIM(RTRIM(CAST(p.EmployeeID AS nvarchar(32)))) = @EmployeeID
      )
      AND TRY_CONVERT(int, i.RETIREYEAR) IS NOT NULL
    ORDER BY
        TRY_CONVERT(int, i.RETIREYEAR) DESC,
        TRY_CONVERT(date, p.EndDate) DESC,
        TRY_CONVERT(date, p.BeginDate) DESC,
        LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64)))) DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayEmployeeOptions
    @RetireYear int = NULL,
    @KeywordLike nvarchar(128),
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH PositionDedup AS (
        SELECT
            LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64)))) AS position_id,
            LTRIM(RTRIM(CAST(p.EmployeeID AS nvarchar(32)))) AS employee_id,
            TRY_CONVERT(int, p.OrgType) AS org_type,
            TRY_CONVERT(int, p.BSType) AS bs_type,
            LTRIM(RTRIM(CAST(p.OrgUnitID AS nvarchar(32)))) AS org_unit_id,
            ROW_NUMBER() OVER (
                PARTITION BY LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64))))
                ORDER BY
                    TRY_CONVERT(date, p.EndDate) DESC,
                    TRY_CONVERT(date, p.BeginDate) DESC,
                    LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64)))) DESC
            ) AS rn
        FROM dbo.fn_InterfacePosition(@EffectiveDate) AS p
        WHERE TRY_CONVERT(int, p.SignPos) = 100
    ),
    InfoDataDedup AS (
        SELECT
            LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32)))) AS employee_id,
            LTRIM(RTRIM(COALESCE(CAST(i.FULLNAMETH AS nvarchar(200)), N''))) AS employee_name,
            LTRIM(RTRIM(COALESCE(CAST(i.POSNAME AS nvarchar(200)), N''))) AS pos_name,
            LTRIM(RTRIM(CAST(i.POSCODE AS nvarchar(64)))) AS position_id,
            TRY_CONVERT(int, i.RETIREYEAR) AS retire_year,
            ROW_NUMBER() OVER (
                PARTITION BY LTRIM(RTRIM(CAST(i.POSCODE AS nvarchar(64))))
                ORDER BY
                    TRY_CONVERT(int, i.RETIREYEAR) DESC,
                    LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32)))) DESC
            ) AS rn
        FROM dbo.InfoData AS i
        WHERE (@RetireYear IS NULL OR TRY_CONVERT(int, i.RETIREYEAR) = @RetireYear)
    )
    SELECT
        src.employee_id,
        MAX(src.employee_name) AS employee_name,
        MAX(src.pos_name) AS pos_name,
        MAX(src.unit_name) AS unit_name,
        MAX(src.delay_type) AS delay_type,
        CASE WHEN MAX(src.delay_type) = 2 THEN 'Support' ELSE 'Business' END AS bu_support
    FROM (
        SELECT
            COALESCE(NULLIF(i.employee_id, ''), NULLIF(p.employee_id, '')) AS employee_id,
            NULLIF(i.employee_name, '') AS employee_name,
            NULLIF(i.pos_name, '') AS pos_name,
            NULLIF(LTRIM(RTRIM(CAST(u.UnitName AS nvarchar(200)))), '') AS unit_name,
            CASE
                WHEN LTRIM(RTRIM(CAST(u.BGNo AS nvarchar(32)))) = N'905'
                  OR UPPER(LTRIM(RTRIM(CAST(u.UnitName AS nvarchar(255))))) IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')
                  OR UPPER(LTRIM(RTRIM(CAST(u.UnitAbbr AS nvarchar(255))))) = N'HO'
                    THEN 2
                WHEN p.org_type = 2 AND p.bs_type = 2
                    THEN 2
                ELSE 1
            END AS delay_type
        FROM PositionDedup AS p
        INNER JOIN InfoDataDedup AS i
            ON i.position_id = p.position_id
           AND i.rn = 1
        LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS u
            ON LTRIM(RTRIM(CAST(u.OrgUnitNo AS nvarchar(32)))) = p.org_unit_id
        WHERE p.rn = 1
    ) AS src
    WHERE src.employee_id IS NOT NULL
      AND src.employee_id <> ''
      AND (
            @KeywordLike = N'%%'
         OR src.employee_id LIKE @KeywordLike
         OR COALESCE(src.employee_name, '') LIKE @KeywordLike
         OR COALESCE(src.pos_name, '') LIKE @KeywordLike
      )
    GROUP BY src.employee_id
    ORDER BY src.employee_id ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayEmployeeOrgMeta
    @EmployeeIdsCsv nvarchar(max),
    @EffectiveDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target_ids AS (
        SELECT DISTINCT LTRIM(RTRIM(value)) AS employee_id
        FROM STRING_SPLIT(@EmployeeIdsCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    ),
    PositionDedup AS (
        SELECT
            LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64)))) AS position_id,
            LTRIM(RTRIM(CAST(p.EmployeeID AS nvarchar(32)))) AS employee_id,
            TRY_CONVERT(int, p.OrgType) AS org_type,
            TRY_CONVERT(int, p.BSType) AS bs_type,
            LTRIM(RTRIM(CAST(p.OrgUnitID AS nvarchar(32)))) AS org_unit_id,
            ROW_NUMBER() OVER (
                PARTITION BY LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64))))
                ORDER BY
                    TRY_CONVERT(date, p.EndDate) DESC,
                    TRY_CONVERT(date, p.BeginDate) DESC,
                    LTRIM(RTRIM(CAST(p.PositionID AS nvarchar(64)))) DESC
            ) AS rn
        FROM dbo.fn_InterfacePosition(@EffectiveDate) AS p
        WHERE TRY_CONVERT(int, p.SignPos) = 100
    ),
    InfoDataDedup AS (
        SELECT
            LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32)))) AS employee_id,
            LTRIM(RTRIM(CAST(i.POSCODE AS nvarchar(64)))) AS position_id,
            TRY_CONVERT(int, i.RETIREYEAR) AS retire_year,
            ROW_NUMBER() OVER (
                PARTITION BY LTRIM(RTRIM(CAST(i.POSCODE AS nvarchar(64))))
                ORDER BY
                    TRY_CONVERT(int, i.RETIREYEAR) DESC,
                    LTRIM(RTRIM(CAST(i.CODE AS nvarchar(32)))) DESC
            ) AS rn
        FROM dbo.InfoData AS i
    )
    SELECT
        src.employee_id,
        MAX(src.unit_name) AS unit_name,
        MAX(src.delay_type) AS delay_type
    FROM (
        SELECT
            COALESCE(NULLIF(i.employee_id, ''), NULLIF(p.employee_id, '')) AS employee_id,
            NULLIF(LTRIM(RTRIM(CAST(u.UnitName AS nvarchar(200)))), '') AS unit_name,
            CASE
                WHEN LTRIM(RTRIM(CAST(u.BGNo AS nvarchar(32)))) = N'905'
                  OR UPPER(LTRIM(RTRIM(CAST(u.UnitName AS nvarchar(255))))) IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')
                  OR UPPER(LTRIM(RTRIM(CAST(u.UnitAbbr AS nvarchar(255))))) = N'HO'
                    THEN 2
                WHEN p.org_type = 2 AND p.bs_type = 2
                    THEN 2
                ELSE 1
            END AS delay_type
        FROM PositionDedup AS p
        INNER JOIN InfoDataDedup AS i
            ON i.position_id = p.position_id
           AND i.rn = 1
        LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS u
            ON LTRIM(RTRIM(CAST(u.OrgUnitNo AS nvarchar(32)))) = p.org_unit_id
        WHERE p.rn = 1
    ) AS src
    INNER JOIN target_ids AS t
        ON t.employee_id = src.employee_id
    GROUP BY src.employee_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_DelayDuplicateExists
    @EmployeeID varchar(8),
    @DelayYear int,
    @ExcludeDelayID varchar(18) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) 1 AS Found
    FROM dbo.MP_Delay
    WHERE EmployeeID = @EmployeeID
      AND DelayYear = @DelayYear
      AND ISNULL(DelayStatus, 1) = 1
      AND (@ExcludeDelayID IS NULL OR CAST(DelayID AS varchar(18)) <> @ExcludeDelayID);
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report09RetirementLevelFilter
    @EffectiveYear int
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @EffectiveYearAD int = CASE WHEN @EffectiveYear > 2500 THEN @EffectiveYear - 543 ELSE @EffectiveYear END;
    DECLARE @EffectiveYearBE int = @EffectiveYearAD + 543;
    DECLARE @SelectedLevelGroupNo nvarchar(16);

    SELECT TOP (1)
        @SelectedLevelGroupNo = LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16))))
    FROM dbo.MP_BUSupportRateRemark
    WHERE EffectiveYear IN (@EffectiveYearAD, @EffectiveYearBE)
      AND NULLIF(LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))), '') IS NOT NULL
    ORDER BY
        CASE WHEN EffectiveYear = @EffectiveYearBE THEN 0 ELSE 1 END,
        TRY_CONVERT(bigint, BUSupportRateRemarkID) DESC;

    IF @SelectedLevelGroupNo IS NULL OR @SelectedLevelGroupNo = N''
        RETURN;

    ;WITH Selected AS (
        SELECT TOP (1)
            TRY_CONVERT(int, LevelDelayOrder) AS SelectedOrder
        FROM dbo.MP_LevelGroup
        WHERE LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) = @SelectedLevelGroupNo
          AND ISNULL(TRY_CONVERT(int, LevelDelayActiive), 0) = 1
    ),
    Allowed AS (
        SELECT
            LTRIM(RTRIM(CAST(lg.LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo,
            TRY_CONVERT(int, lg.LevelDelayOrder) AS SortOrder
        FROM dbo.MP_LevelGroup AS lg
        CROSS JOIN Selected AS s
        WHERE s.SelectedOrder IS NOT NULL
          AND ISNULL(TRY_CONVERT(int, lg.LevelDelayActiive), 0) = 1
          AND TRY_CONVERT(int, lg.LevelDelayOrder) <= s.SelectedOrder
    )
    SELECT
        @SelectedLevelGroupNo AS SelectedLevelGroupNo,
        LevelGroupNo
    FROM Allowed
    UNION ALL
    SELECT
        @SelectedLevelGroupNo AS SelectedLevelGroupNo,
        @SelectedLevelGroupNo AS LevelGroupNo
    WHERE NOT EXISTS (SELECT 1 FROM Allowed)
    ORDER BY
        LevelGroupNo ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report09RetirementMap
    @EffectiveYear int,
    @FromYear int,
    @ToYear int,
    @EffectiveDate datetime,
    @StructureIsSecondment int = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @AllowedLevel TABLE (
        SelectedLevelGroupNo nvarchar(16) NULL,
        LevelGroupNo nvarchar(16) NOT NULL
    );

    INSERT INTO @AllowedLevel (SelectedLevelGroupNo, LevelGroupNo)
    EXEC dbo.MP_Report09RetirementLevelFilter @EffectiveYear = @EffectiveYear;

    ;WITH delay AS (
        SELECT employee_id, delay_year
        FROM (
            SELECT
                EmployeeID AS employee_id,
                DelayYear AS delay_year,
                ROW_NUMBER() OVER (
                    PARTITION BY EmployeeID
                    ORDER BY COALESCE(UpdateDate, CreateDate) DESC,
                             TRY_CONVERT(bigint, DelayID) DESC
                ) AS rn
            FROM dbo.MP_Delay
            WHERE ISNULL(DelayStatus, 1) = 1
              AND EmployeeID <> ''
              AND DelayYear IS NOT NULL
        ) AS d
        WHERE d.rn = 1
    ),
    base AS (
        SELECT
            CASE
                WHEN @StructureIsSecondment = 0
                 AND ISNULL(unit.IsSecondment, 0) = 1
                 AND rt.Reportto IS NOT NULL
                 AND rt.Reportto <> ''
                    THEN rt.Reportto
                ELSE pos.OrgUnitID
            END AS org_unit_id,
            CASE
                WHEN delay.delay_year = 9999
                    THEN info.RETIREYEAR
                WHEN delay.delay_year IS NOT NULL
                    THEN delay.delay_year
                ELSE info.RETIREYEAR
            END AS retire_year,
            CASE
                WHEN unit.BGNo = '905'
                  OR UPPER(unit.UnitName) IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')
                  OR UPPER(unit.UnitAbbr) = N'HO'
                    THEN 2
                WHEN mappedUnit.BGNo = '905'
                 AND pos.BSType IS NULL
                    THEN 2
                WHEN pos.OrgType = 2
                 AND pos.BSType = 2
                    THEN 2
                ELSE 1
            END AS bs_type,
            info.CODE AS employee_id
        FROM dbo.InfoData AS info
        INNER JOIN dbo.InterfacePosition AS pos
            ON pos.PositionID = info.POSCODE
        LEFT JOIN delay
            ON delay.employee_id = info.CODE
        LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS unit
            ON unit.OrgUnitNo = pos.OrgUnitID
        LEFT JOIN dbo.fn_InterfaceReportto(@EffectiveDate) AS rt
            ON rt.OrgUnitNo = pos.OrgUnitID
        LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS mappedUnit
            ON mappedUnit.OrgUnitNo = CASE
                WHEN @StructureIsSecondment = 0
                 AND ISNULL(unit.IsSecondment, 0) = 1
                 AND rt.Reportto IS NOT NULL
                 AND rt.Reportto <> ''
                    THEN rt.Reportto
                ELSE pos.OrgUnitID
            END
        WHERE CASE
                WHEN delay.delay_year = 9999
                    THEN info.RETIREYEAR
                WHEN delay.delay_year IS NOT NULL
                    THEN delay.delay_year
                ELSE info.RETIREYEAR
            END BETWEEN @FromYear AND @ToYear
          AND CASE
                WHEN @StructureIsSecondment = 0
                 AND ISNULL(unit.IsSecondment, 0) = 1
                 AND rt.Reportto IS NOT NULL
                 AND rt.Reportto <> ''
                    THEN rt.Reportto
                ELSE pos.OrgUnitID
            END <> ''
          AND info.Secondment_text IN ('Employee', 'EMPLOYEE', 'employee')
          AND pos.SignPos = '100'
          AND (
                NOT EXISTS (SELECT 1 FROM @AllowedLevel)
             OR pos.LevelGroupNo IN (SELECT LevelGroupNo FROM @AllowedLevel)
          )
    )
    SELECT
        org_unit_id,
        retire_year,
        bs_type,
        COUNT(DISTINCT employee_id) AS retire_count
    FROM base
    GROUP BY
        org_unit_id,
        retire_year,
        bs_type;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report09Audit
    @EffectiveYear int,
    @FromYear int,
    @ToYear int,
    @EffectiveDate datetime,
    @StructureIsSecondment int = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @AllowedLevel TABLE (
        SelectedLevelGroupNo nvarchar(16) NULL,
        LevelGroupNo nvarchar(16) NOT NULL
    );

    INSERT INTO @AllowedLevel (SelectedLevelGroupNo, LevelGroupNo)
    EXEC dbo.MP_Report09RetirementLevelFilter @EffectiveYear = @EffectiveYear;

    ;WITH delay AS (
        SELECT employee_id, delay_year
        FROM (
            SELECT
                LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(32)))) AS employee_id,
                TRY_CONVERT(int, DelayYear) AS delay_year,
                ROW_NUMBER() OVER (
                    PARTITION BY LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(32))))
                    ORDER BY COALESCE(UpdateDate, CreateDate) DESC,
                             TRY_CONVERT(bigint, DelayID) DESC
                ) AS rn
            FROM dbo.MP_Delay
            WHERE ISNULL(DelayStatus, 1) = 1
              AND LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(32)))) <> ''
              AND TRY_CONVERT(int, DelayYear) IS NOT NULL
        ) AS d
        WHERE d.rn = 1
    ),
    base AS (
        SELECT
            NULLIF(LTRIM(RTRIM(CAST(info.CODE AS nvarchar(64)))), '') AS employee_key,
            LTRIM(RTRIM(CAST(pos.PositionID AS nvarchar(64)))) AS position_key,
            CASE
                WHEN @StructureIsSecondment = 0
                 AND ISNULL(srcUnit.IsSecondment, 0) = 1
                 AND rt.Reportto IS NOT NULL
                 AND LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32)))) <> ''
                    THEN LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32))))
                ELSE LTRIM(RTRIM(CAST(pos.OrgUnitID AS nvarchar(32))))
            END AS org_unit_id,
            LTRIM(RTRIM(CAST(mappedUnit.UnitAbbr AS nvarchar(255)))) AS unit_abbr,
            LTRIM(RTRIM(CAST(mappedUnit.UnitName AS nvarchar(255)))) AS unit_name,
            CASE
                WHEN delay.delay_year = 9999
                    THEN TRY_CONVERT(int, info.RETIREYEAR)
                WHEN delay.delay_year IS NOT NULL
                    THEN delay.delay_year
                ELSE TRY_CONVERT(int, info.RETIREYEAR)
            END AS retire_year,
            CASE
                WHEN LTRIM(RTRIM(CAST(srcUnit.BGNo AS nvarchar(32)))) = '905'
                  OR UPPER(LTRIM(RTRIM(CAST(srcUnit.UnitName AS nvarchar(255))))) IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')
                  OR UPPER(LTRIM(RTRIM(CAST(srcUnit.UnitAbbr AS nvarchar(255))))) = N'HO'
                    THEN N'Support'
                WHEN LTRIM(RTRIM(CAST(mappedUnit.BGNo AS nvarchar(32)))) = '905'
                 AND NULLIF(LTRIM(RTRIM(CAST(pos.BSType AS nvarchar(32)))), '') IS NULL
                    THEN N'Support'
                WHEN TRY_CONVERT(int, pos.OrgType) = 2
                 AND TRY_CONVERT(int, pos.BSType) = 2
                    THEN N'Support'
                ELSE N'BU'
            END AS bs_type,
            CASE
                WHEN UPPER(LTRIM(RTRIM(CAST(info.Secondment_text AS nvarchar(64))))) = 'EMPLOYEE'
                    THEN 1
                ELSE 0
            END AS pass_employee,
            CASE
                WHEN TRY_CONVERT(int, pos.SignPos) = 100
                    THEN 1
                ELSE 0
            END AS pass_signpos,
            CASE
                WHEN NOT EXISTS (SELECT 1 FROM @AllowedLevel)
                  OR LTRIM(RTRIM(CAST(pos.LevelGroupNo AS nvarchar(16)))) IN (SELECT LevelGroupNo FROM @AllowedLevel)
                    THEN 1
                ELSE 0
            END AS pass_level
        FROM dbo.InfoData AS info
        INNER JOIN dbo.InterfacePosition AS pos
            ON LTRIM(RTRIM(CAST(pos.PositionID AS nvarchar(64)))) =
               LTRIM(RTRIM(CAST(info.POSCODE AS nvarchar(64))))
        LEFT JOIN delay
            ON delay.employee_id = LTRIM(RTRIM(CAST(info.CODE AS nvarchar(32))))
        LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS srcUnit
            ON LTRIM(RTRIM(CAST(srcUnit.OrgUnitNo AS nvarchar(32)))) =
               LTRIM(RTRIM(CAST(pos.OrgUnitID AS nvarchar(32))))
        LEFT JOIN dbo.fn_InterfaceReportto(@EffectiveDate) AS rt
            ON LTRIM(RTRIM(CAST(rt.OrgUnitNo AS nvarchar(32)))) =
               LTRIM(RTRIM(CAST(pos.OrgUnitID AS nvarchar(32))))
        LEFT JOIN dbo.fn_InterfaceUnit(@EffectiveDate) AS mappedUnit
            ON LTRIM(RTRIM(CAST(mappedUnit.OrgUnitNo AS nvarchar(32)))) = CASE
                WHEN @StructureIsSecondment = 0
                 AND ISNULL(srcUnit.IsSecondment, 0) = 1
                 AND rt.Reportto IS NOT NULL
                 AND LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32)))) <> ''
                    THEN LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32))))
                ELSE LTRIM(RTRIM(CAST(pos.OrgUnitID AS nvarchar(32))))
            END
        WHERE CASE
                WHEN delay.delay_year = 9999
                    THEN TRY_CONVERT(int, info.RETIREYEAR)
                WHEN delay.delay_year IS NOT NULL
                    THEN delay.delay_year
                ELSE TRY_CONVERT(int, info.RETIREYEAR)
            END BETWEEN @FromYear AND @ToYear
    )
    SELECT
        stage.stage_code,
        stage.stage_name,
        NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '') AS org_unit_id,
        COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_abbr AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')) AS unit_abbr,
        COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_name AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')) AS unit_name,
        base.retire_year,
        base.bs_type,
        COUNT_BIG(1) AS position_rows,
        COUNT(DISTINCT COALESCE(base.employee_key, CONCAT(N'POSITION:', base.position_key))) AS employee_count
    FROM base
    CROSS APPLY (VALUES
        (N'01', N'ช่วงปีเกษียณ', 1),
        (N'02', N'เฉพาะ Employee', base.pass_employee),
        (N'03', N'เฉพาะ SignPos=100', base.pass_employee * base.pass_signpos),
        (N'04', N'เฉพาะ Level ที่ใช้คำนวณ', base.pass_employee * base.pass_signpos * base.pass_level),
        (N'05', N'มีหน่วยงานหลัง map secondment', base.pass_employee * base.pass_signpos * base.pass_level * CASE WHEN NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '') IS NOT NULL THEN 1 ELSE 0 END)
    ) AS stage(stage_code, stage_name, pass_filter)
    WHERE stage.pass_filter = 1
    GROUP BY
        stage.stage_code,
        stage.stage_name,
        NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), ''),
        COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_abbr AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')),
        COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_name AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')),
        base.retire_year,
        base.bs_type
    ORDER BY
        stage.stage_code,
        org_unit_id,
        base.retire_year,
        base.bs_type;
END;
GO
