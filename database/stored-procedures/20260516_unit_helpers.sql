SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_UnitOtherUnitsFromInfoData
    @EmployeeID varchar(32),
    @EmployeeIDNoZero varchar(32)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DISTINCT
        LTRIM(RTRIM(CAST(UNITCODE AS varchar(20)))) AS OrgUnitNo
    FROM dbo.InfoData
    WHERE NULLIF(LTRIM(RTRIM(CAST(UNITCODE AS varchar(20)))), '') IS NOT NULL
      AND LTRIM(RTRIM(CAST(CODE AS varchar(20)))) IN (@EmployeeID, @EmployeeIDNoZero);
END;
GO
