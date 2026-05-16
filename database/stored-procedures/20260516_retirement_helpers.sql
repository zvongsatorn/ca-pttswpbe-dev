SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_RetirementLevelOptions
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo,
        LTRIM(RTRIM(CAST(LevelGroupName AS nvarchar(255)))) AS LevelGroupName,
        TRY_CONVERT(int, LevelDelayOrder) AS LevelDelayOrder
    FROM dbo.MP_LevelGroup
    WHERE ISNULL(TRY_CONVERT(int, LevelDelayActiive), 0) = 1
    ORDER BY
        COALESCE(TRY_CONVERT(int, LevelDelayOrder), -9999) DESC,
        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16))));
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_RetirementRateRows
    @EffectiveYear int,
    @TargetEffectiveYear int = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        BUSupportRateID,
        COALESCE(@TargetEffectiveYear, EffectiveYear) AS EffectiveYear,
        CASE
            WHEN @TargetEffectiveYear IS NOT NULL AND TRY_CONVERT(int, [Year]) < 2500
                THEN TRY_CONVERT(int, [Year]) + 543
            ELSE TRY_CONVERT(int, [Year])
        END AS [Year],
        TypeRate,
        Rate,
        Base,
        BUSupportRateStatus,
        CreateBy,
        CreateDate,
        UpdateBy,
        UpdateDate
    FROM dbo.MP_BUSupportRate
    WHERE EffectiveYear = @EffectiveYear
    ORDER BY [Year], TypeRate;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_RetirementRemarkRaw
    @EffectiveYear int
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        LTRIM(RTRIM(CAST(Remark AS nvarchar(500)))) AS Remark,
        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo
    FROM dbo.MP_BUSupportRateRemark
    WHERE EffectiveYear = @EffectiveYear
    ORDER BY TRY_CONVERT(bigint, BUSupportRateRemarkID) DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_RetirementRateUpsert
    @EffectiveYear int,
    @Year int,
    @TypeRate int,
    @Rate decimal(18,2),
    @Base int,
    @User varchar(20),
    @Now datetime
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM dbo.MP_BUSupportRate
        WHERE EffectiveYear = @EffectiveYear
          AND [Year] = @Year
          AND TypeRate = @TypeRate
    )
    BEGIN
        UPDATE dbo.MP_BUSupportRate
        SET
            Rate = @Rate,
            Base = @Base,
            BUSupportRateStatus = COALESCE(BUSupportRateStatus, 1),
            UpdateBy = @User,
            UpdateDate = @Now
        WHERE EffectiveYear = @EffectiveYear
          AND [Year] = @Year
          AND TypeRate = @TypeRate;

        RETURN;
    END;

    INSERT INTO dbo.MP_BUSupportRate (
        EffectiveYear,
        [Year],
        TypeRate,
        Rate,
        Base,
        BUSupportRateStatus,
        CreateBy,
        CreateDate,
        UpdateBy,
        UpdateDate
    )
    VALUES (
        @EffectiveYear,
        @Year,
        @TypeRate,
        @Rate,
        @Base,
        1,
        @User,
        @Now,
        @User,
        @Now
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_RetirementRemarkLevelUpdate
    @EffectiveYear int,
    @LevelGroupNo varchar(4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.MP_BUSupportRateRemark
    SET LevelGroupNo = @LevelGroupNo
    WHERE EffectiveYear = @EffectiveYear;
END;
GO
