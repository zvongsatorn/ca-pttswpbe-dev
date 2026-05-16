SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_UserOtherUpdate
    @EmployeeID varchar(50),
    @FullName varchar(200),
    @Email varchar(200),
    @UpdateBy varchar(50),
    @UpdateDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.MP_UserOther
    SET
        FullName = @FullName,
        Email = @Email,
        UpdateBy = @UpdateBy,
        UpdateDate = @UpdateDate
    WHERE EmployeeID = @EmployeeID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_UserWithPasswordGet
    @EmployeeID varchar(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) *
    FROM dbo.MP_User
    WHERE EmployeeID = @EmployeeID
       OR LTRIM(RTRIM(LOWER(EmployeeID))) = LTRIM(RTRIM(LOWER(@EmployeeID)))
    ORDER BY
        CASE WHEN EmployeeID = @EmployeeID THEN 0 ELSE 1 END;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_UserOtherByEmployeeGet
    @EmployeeID varchar(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) *
    FROM dbo.MP_UserOther
    WHERE EmployeeID = @EmployeeID
       OR LTRIM(RTRIM(LOWER(EmployeeID))) = LTRIM(RTRIM(LOWER(@EmployeeID)))
    ORDER BY
        CASE WHEN EmployeeID = @EmployeeID THEN 0 ELSE 1 END;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_UserProfilePictureUpdate
    @EmployeeID varchar(50),
    @ProfilePicture varchar(50)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.MP_User
    SET ProfilePicture = @ProfilePicture
    WHERE EmployeeID = @EmployeeID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_UserListFallback
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(50)))) AS EmployeeID,
        COALESCE(
            NULLIF(LTRIM(RTRIM(CAST(FullName AS nvarchar(255)))), ''),
            LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(50))))
        ) AS NameAll
    FROM dbo.MP_User
    WHERE EmployeeID IS NOT NULL
    ORDER BY EmployeeID;
END;
GO
