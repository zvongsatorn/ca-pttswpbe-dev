SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.MP_MailToCreate
    @SendFromBy varchar(8),
    @SendFromDate datetime,
    @SendToBy varchar(8) = NULL,
    @EmailTo varchar(100),
    @MailFrom varchar(100),
    @MailSubject varchar(100),
    @MailBody varchar(8000),
    @EffectiveDate datetime,
    @IsCC int,
    @IsSend int,
    @Remark varchar(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Inserted TABLE (MailToID decimal(18, 0));

    INSERT INTO dbo.MP_MailTo (
        SendFromBy,
        SendFromDate,
        SendToBy,
        EmailTo,
        MailFrom,
        MailSubject,
        MailBody,
        EffectiveDate,
        IsCC,
        IsSend,
        Remark
    )
    OUTPUT INSERTED.MailToID INTO @Inserted
    VALUES (
        @SendFromBy,
        @SendFromDate,
        @SendToBy,
        @EmailTo,
        @MailFrom,
        @MailSubject,
        @MailBody,
        @EffectiveDate,
        @IsCC,
        @IsSend,
        @Remark
    );

    SELECT TOP (1) MailToID FROM @Inserted;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_MailCCCreate
    @MailToID decimal(18, 0),
    @CCTo varchar(8) = NULL,
    @EmailCC varchar(100)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.MP_MailCC (
        MailToID,
        CCTo,
        EmailCC
    )
    VALUES (
        @MailToID,
        @CCTo,
        @EmailCC
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_MailToListCreate
    @MailToID decimal(18, 0),
    @RefNo varchar(20),
    @CreateBy varchar(20),
    @CreateDate datetime
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.MP_MailToList (
        MailToID,
        RefNo,
        CreateBy,
        CreateDate
    )
    VALUES (
        @MailToID,
        @RefNo,
        @CreateBy,
        @CreateDate
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_MailAlertTransactionLookup
    @TransactionNosCsv varchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        TransactionNo,
        TransactionType,
        TransactionDesc
    FROM dbo.MP_Transactions WITH (NOLOCK)
    WHERE TransactionNo IN (
        SELECT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@TransactionNosCsv, ',')
        WHERE LTRIM(RTRIM(value)) <> ''
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.MP_MailAlertDocumentTransactionItems
    @DocumentNo varchar(20)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH DocItems AS (
        SELECT DISTINCT ItemID
        FROM dbo.MP_DocumentItems WITH (NOLOCK)
        WHERE DocumentNo = @DocumentNo
    )
    SELECT
        d.ItemID AS TransactionNo,
        t.TransactionType,
        t.TransactionDesc
    FROM DocItems AS d
    LEFT JOIN dbo.MP_Transactions AS t WITH (NOLOCK)
        ON t.TransactionNo = d.ItemID
    ORDER BY d.ItemID, t.TransactionType;
END;
GO
