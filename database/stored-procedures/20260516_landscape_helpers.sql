SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeList
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') AS OrgUnitNo,
        CONVERT(varchar(10), [BeginDate], 23) AS BeginDate,
        CONVERT(varchar(10), [EndDate], 23) AS EndDate,
        CAST(vp AS decimal(18,2)) AS vp,
        CAST(dm AS decimal(18,2)) AS dm,
        CAST(sr AS decimal(18,2)) AS sr,
        CAST(jr AS decimal(18,2)) AS jr
    FROM dbo.MP_Landscape
    ORDER BY
        CASE WHEN NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL THEN 0 ELSE 1 END,
        NULLIF(LTRIM(RTRIM(OrgUnitNo)), ''),
        [BeginDate] DESC,
        [EndDate] DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeInsert
    @OrgUnitNo varchar(8) = NULL,
    @BeginDate date,
    @EndDate date,
    @vp decimal(18,2),
    @dm decimal(18,2),
    @sr decimal(18,2),
    @jr decimal(18,2)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.MP_Landscape (
        OrgUnitNo,
        [BeginDate],
        [EndDate],
        vp,
        dm,
        sr,
        jr
    )
    VALUES (
        @OrgUnitNo,
        @BeginDate,
        @EndDate,
        @vp,
        @dm,
        @sr,
        @jr
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapePeriodOverlap
    @OrgUnitNo varchar(8) = NULL,
    @BeginDate date,
    @EndDate date,
    @HasOriginal bit = 0,
    @OriginalOrgUnitNo varchar(8) = NULL,
    @OriginalBeginDate date = NULL,
    @OriginalEndDate date = NULL,
    @OriginalVp decimal(18,2) = NULL,
    @OriginalDm decimal(18,2) = NULL,
    @OriginalSr decimal(18,2) = NULL,
    @OriginalJr decimal(18,2) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) 1 AS HasOverlap
    FROM dbo.MP_Landscape
    WHERE
        (
            (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL AND @OrgUnitNo IS NULL)
            OR (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') = @OrgUnitNo)
        )
        AND [BeginDate] <= @EndDate
        AND [EndDate] >= @BeginDate
        AND (
            ISNULL(@HasOriginal, 0) = 0
            OR NOT (
                (
                    (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL AND @OriginalOrgUnitNo IS NULL)
                    OR (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') = @OriginalOrgUnitNo)
                )
                AND [BeginDate] = @OriginalBeginDate
                AND [EndDate] = @OriginalEndDate
                AND CAST(vp AS decimal(18,2)) = @OriginalVp
                AND CAST(dm AS decimal(18,2)) = @OriginalDm
                AND CAST(sr AS decimal(18,2)) = @OriginalSr
                AND CAST(jr AS decimal(18,2)) = @OriginalJr
            )
        );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeUpdateOriginal
    @OriginalOrgUnitNo varchar(8) = NULL,
    @OriginalBeginDate date,
    @OriginalEndDate date,
    @OriginalVp decimal(18,2),
    @OriginalDm decimal(18,2),
    @OriginalSr decimal(18,2),
    @OriginalJr decimal(18,2),
    @OrgUnitNo varchar(8) = NULL,
    @BeginDate date,
    @EndDate date,
    @vp decimal(18,2),
    @dm decimal(18,2),
    @sr decimal(18,2),
    @jr decimal(18,2),
    @RowsAffected int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target AS (
        SELECT TOP (1) *
        FROM dbo.MP_Landscape
        WHERE
            (
                (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL AND @OriginalOrgUnitNo IS NULL)
                OR (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') = @OriginalOrgUnitNo)
            )
            AND [BeginDate] = @OriginalBeginDate
            AND [EndDate] = @OriginalEndDate
            AND CAST(vp AS decimal(18,2)) = @OriginalVp
            AND CAST(dm AS decimal(18,2)) = @OriginalDm
            AND CAST(sr AS decimal(18,2)) = @OriginalSr
            AND CAST(jr AS decimal(18,2)) = @OriginalJr
        ORDER BY [BeginDate] DESC, [EndDate] DESC
    )
    UPDATE target
    SET
        OrgUnitNo = @OrgUnitNo,
        [BeginDate] = @BeginDate,
        [EndDate] = @EndDate,
        vp = @vp,
        dm = @dm,
        sr = @sr,
        jr = @jr;

    SET @RowsAffected = @@ROWCOUNT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeDeleteOriginal
    @OriginalOrgUnitNo varchar(8) = NULL,
    @OriginalBeginDate date,
    @OriginalEndDate date,
    @OriginalVp decimal(18,2),
    @OriginalDm decimal(18,2),
    @OriginalSr decimal(18,2),
    @OriginalJr decimal(18,2),
    @RowsAffected int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target AS (
        SELECT TOP (1) *
        FROM dbo.MP_Landscape
        WHERE
            (
                (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL AND @OriginalOrgUnitNo IS NULL)
                OR (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') = @OriginalOrgUnitNo)
            )
            AND [BeginDate] = @OriginalBeginDate
            AND [EndDate] = @OriginalEndDate
            AND CAST(vp AS decimal(18,2)) = @OriginalVp
            AND CAST(dm AS decimal(18,2)) = @OriginalDm
            AND CAST(sr AS decimal(18,2)) = @OriginalSr
            AND CAST(jr AS decimal(18,2)) = @OriginalJr
        ORDER BY [BeginDate] DESC, [EndDate] DESC
    )
    DELETE FROM target;

    SET @RowsAffected = @@ROWCOUNT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeFormulaIsReady
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CASE WHEN OBJECT_ID('dbo.MP_LandscapeFormula', 'U') IS NULL THEN 0 ELSE 1 END AS IsReady;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeFormulaList
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        LandscapeFormulaID,
        FormulaKey,
        FormulaName,
        CONVERT(varchar(10), [BeginDate], 23) AS BeginDate,
        CONVERT(varchar(10), [EndDate], 23) AS EndDate,
        FormulaJson,
        IsActive,
        CreateBy,
        CONVERT(varchar(19), [CreateDate], 120) AS CreateDate,
        UpdateBy,
        CONVERT(varchar(19), [UpdateDate], 120) AS UpdateDate
    FROM dbo.MP_LandscapeFormula
    ORDER BY FormulaKey ASC, BeginDate DESC, EndDate DESC, LandscapeFormulaID DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeFormulaPeriodOverlap
    @FormulaKey varchar(100),
    @BeginDate date,
    @EndDate date,
    @ExcludeFormulaId bigint = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) 1 AS HasOverlap
    FROM dbo.MP_LandscapeFormula
    WHERE FormulaKey = @FormulaKey
      AND IsActive = 1
      AND [BeginDate] <= @EndDate
      AND [EndDate] >= @BeginDate
      AND (@ExcludeFormulaId IS NULL OR LandscapeFormulaID <> @ExcludeFormulaId);
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeFormulaInsert
    @FormulaKey varchar(100),
    @FormulaName nvarchar(255) = NULL,
    @BeginDate date,
    @EndDate date,
    @FormulaJson nvarchar(max),
    @IsActive bit,
    @CreateBy varchar(32)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.MP_LandscapeFormula (
        FormulaKey,
        FormulaName,
        [BeginDate],
        [EndDate],
        FormulaJson,
        IsActive,
        CreateBy,
        CreateDate
    )
    VALUES (
        @FormulaKey,
        @FormulaName,
        @BeginDate,
        @EndDate,
        @FormulaJson,
        @IsActive,
        @CreateBy,
        GETDATE()
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeFormulaUpdate
    @LandscapeFormulaID bigint,
    @FormulaKey varchar(100),
    @FormulaName nvarchar(255) = NULL,
    @BeginDate date,
    @EndDate date,
    @FormulaJson nvarchar(max),
    @IsActive bit,
    @UpdateBy varchar(32),
    @RowsAffected int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.MP_LandscapeFormula
    SET
        FormulaKey = @FormulaKey,
        FormulaName = @FormulaName,
        [BeginDate] = @BeginDate,
        [EndDate] = @EndDate,
        FormulaJson = @FormulaJson,
        IsActive = @IsActive,
        UpdateBy = @UpdateBy,
        UpdateDate = GETDATE()
    WHERE LandscapeFormulaID = @LandscapeFormulaID;

    SET @RowsAffected = @@ROWCOUNT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_LandscapeFormulaDelete
    @LandscapeFormulaID bigint,
    @RowsAffected int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.MP_LandscapeFormula
    WHERE LandscapeFormulaID = @LandscapeFormulaID;

    SET @RowsAffected = @@ROWCOUNT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_Report7FormulaByEffectiveDate
    @FormulaKey varchar(100),
    @EffectiveDate date
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        FormulaJson
    FROM dbo.MP_LandscapeFormula
    WHERE FormulaKey = @FormulaKey
      AND IsActive = 1
      AND @EffectiveDate BETWEEN [BeginDate] AND [EndDate]
    ORDER BY [BeginDate] DESC, LandscapeFormulaID DESC;
END;
GO
