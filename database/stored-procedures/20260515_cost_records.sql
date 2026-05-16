SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_CostRecordList
    @FromDate date,
    @ToDate date
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        LTRIM(RTRIM(CAST(OrgUnitNo AS nvarchar(64)))) AS OrgUnitNo,
        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(32)))) AS LevelGroupNo,
        CONVERT(varchar(10), EffectiveDate, 23) AS EffectiveDate,
        COALESCE(CAST(Note AS nvarchar(200)), N'') AS Note,
        CAST(COALESCE(TRY_CONVERT(decimal(18,4), TotalCost), 0) AS decimal(18,4)) AS Cost
    FROM dbo.MP_CostEmployee
    WHERE EffectiveDate BETWEEN @FromDate AND @ToDate
    ORDER BY
        EffectiveDate DESC,
        OrgUnitNo,
        LevelGroupNo;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_CostRecordUpsert
    @OrgUnitNo nvarchar(32),
    @LevelGroupNo nvarchar(16),
    @EffectiveDate date,
    @Note nvarchar(200) = NULL,
    @Cost decimal(18,4),
    @Action nvarchar(16) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT TOP (1) 1
        FROM dbo.MP_CostEmployee
        WHERE LTRIM(RTRIM(CAST(OrgUnitNo AS nvarchar(64)))) = @OrgUnitNo
          AND LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(32)))) = @LevelGroupNo
          AND EffectiveDate = @EffectiveDate
    )
    BEGIN
        UPDATE dbo.MP_CostEmployee
        SET
            TotalCost = @Cost,
            Note = @Note
        WHERE LTRIM(RTRIM(CAST(OrgUnitNo AS nvarchar(64)))) = @OrgUnitNo
          AND LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(32)))) = @LevelGroupNo
          AND EffectiveDate = @EffectiveDate;

        SET @Action = N'updated';
        RETURN;
    END;

    INSERT INTO dbo.MP_CostEmployee (
        OrgUnitNo,
        LevelGroupNo,
        EffectiveDate,
        Note,
        TotalCost
    )
    VALUES (
        @OrgUnitNo,
        @LevelGroupNo,
        @EffectiveDate,
        @Note,
        @Cost
    );

    SET @Action = N'inserted';
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_CostRecordUpdateOriginal
    @OriginalOrgUnitNo nvarchar(32),
    @OriginalLevelGroupNo nvarchar(16),
    @OriginalEffectiveDate date,
    @OriginalNote nvarchar(200) = NULL,
    @OriginalCost decimal(18,4),
    @NextOrgUnitNo nvarchar(32),
    @NextLevelGroupNo nvarchar(16),
    @NextEffectiveDate date,
    @NextNote nvarchar(200) = NULL,
    @NextCost decimal(18,4),
    @RowsAffected int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target AS (
        SELECT TOP (1) *
        FROM dbo.MP_CostEmployee
        WHERE LTRIM(RTRIM(CAST(OrgUnitNo AS nvarchar(64)))) = @OriginalOrgUnitNo
          AND LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(32)))) = @OriginalLevelGroupNo
          AND EffectiveDate = @OriginalEffectiveDate
          AND COALESCE(TRY_CONVERT(decimal(18,4), TotalCost), 0) = @OriginalCost
        ORDER BY
            EffectiveDate DESC,
            TRY_CONVERT(decimal(18,0), CostEmployeeID) DESC
    )
    UPDATE target
    SET
        OrgUnitNo = @NextOrgUnitNo,
        LevelGroupNo = @NextLevelGroupNo,
        EffectiveDate = @NextEffectiveDate,
        Note = @NextNote,
        TotalCost = @NextCost;

    SET @RowsAffected = @@ROWCOUNT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_CostRecordDeleteOriginal
    @OriginalOrgUnitNo nvarchar(32),
    @OriginalLevelGroupNo nvarchar(16),
    @OriginalEffectiveDate date,
    @OriginalNote nvarchar(200) = NULL,
    @OriginalCost decimal(18,4),
    @RowsAffected int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH target AS (
        SELECT TOP (1) *
        FROM dbo.MP_CostEmployee
        WHERE LTRIM(RTRIM(CAST(OrgUnitNo AS nvarchar(64)))) = @OriginalOrgUnitNo
          AND LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(32)))) = @OriginalLevelGroupNo
          AND EffectiveDate = @OriginalEffectiveDate
          AND COALESCE(TRY_CONVERT(decimal(18,4), TotalCost), 0) = @OriginalCost
        ORDER BY
            EffectiveDate DESC,
            TRY_CONVERT(decimal(18,0), CostEmployeeID) DESC
    )
    DELETE FROM target;

    SET @RowsAffected = @@ROWCOUNT;
END;
GO
