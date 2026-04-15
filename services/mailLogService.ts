import { sql, poolPromise } from '../config/db.js';
import configService from './configService.js';

export interface MailCcRecipient {
    employeeId?: string | null;
    email: string;
}

export interface CreateMailLogPayload {
    sendFromBy: string;
    sendFromDate: Date;
    sendToBy?: string | null;
    emailTo: string;
    mailFrom?: string | null;
    mailSubject: string;
    mailBody: string;
    effectiveDate?: Date | null;
    isCC: number;
    isSend: number;
    ccRecipients?: MailCcRecipient[];
    refNo?: string | null;
    createBy?: string | null;
    createDate?: Date | null;
}

const fit = (value: string | null | undefined, maxLength: number): string => {
    return (value || '').toString().trim().slice(0, maxLength);
};

const isMissingMailToIdError = (error: unknown): boolean => {
    const message = String((error as any)?.message || '').toLowerCase();
    return message.includes('mailtoid') && (message.includes('null') || message.includes('explicit value'));
};

const getMailFromDefaults = async (): Promise<{ mailFrom: string }> => {
    const senderFromConfig = (await configService.getConfig('MAIL_SENDER')).trim();
    const senderFromEnv = (process.env.MAIL_SENDER || '').trim();
    const mailFrom = senderFromConfig || senderFromEnv;
    return { mailFrom };
};

const insertMailTo = async (tx: sql.Transaction, payload: CreateMailLogPayload): Promise<number> => {
    const defaults = await getMailFromDefaults();
    const finalMailFrom = fit(payload.mailFrom ?? defaults.mailFrom, 100);

    const baseRequest = new sql.Request(tx);
    baseRequest.input('SendFromBy', sql.VarChar(8), fit(payload.sendFromBy, 8));
    baseRequest.input('SendFromDate', sql.DateTime, payload.sendFromDate);
    baseRequest.input('SendToBy', sql.VarChar(8), fit(payload.sendToBy, 8));
    baseRequest.input('EmailTo', sql.VarChar(100), fit(payload.emailTo, 100));
    baseRequest.input('MailFrom', sql.VarChar(100), finalMailFrom);
    baseRequest.input('MailSubject', sql.VarChar(100), fit(payload.mailSubject, 100));
    baseRequest.input('MailBody', sql.VarChar(8000), fit(payload.mailBody, 8000));
    baseRequest.input('EffectiveDate', sql.DateTime, payload.effectiveDate ?? payload.sendFromDate);
    baseRequest.input('IsCC', sql.Int, payload.isCC);
    baseRequest.input('IsSend', sql.Int, payload.isSend);

    try {
        const result = await baseRequest.query(`
            INSERT INTO MP_MailTo (
                SendFromBy, SendFromDate, SendToBy, EmailTo, MailFrom, MailSubject, MailBody, EffectiveDate, IsCC, IsSend
            )
            OUTPUT INSERTED.MailToID
            VALUES (
                @SendFromBy, @SendFromDate, @SendToBy, @EmailTo, @MailFrom, @MailSubject, @MailBody, @EffectiveDate, @IsCC, @IsSend
            )
        `);

        const mailToId = result.recordset?.[0]?.MailToID;
        if (mailToId === undefined || mailToId === null) {
            throw new Error('Cannot read MailToID from MP_MailTo insert result');
        }
        return Number(mailToId);
    } catch (error) {
        if (!isMissingMailToIdError(error)) {
            throw error;
        }

        // Fallback for schema where MailToID is not identity/default.
        const manualRequest = new sql.Request(tx);
        manualRequest.input('SendFromBy', sql.VarChar(8), fit(payload.sendFromBy, 8));
        manualRequest.input('SendFromDate', sql.DateTime, payload.sendFromDate);
        manualRequest.input('SendToBy', sql.VarChar(8), fit(payload.sendToBy, 8));
        manualRequest.input('EmailTo', sql.VarChar(100), fit(payload.emailTo, 100));
        manualRequest.input('MailFrom', sql.VarChar(100), finalMailFrom);
        manualRequest.input('MailSubject', sql.VarChar(100), fit(payload.mailSubject, 100));
        manualRequest.input('MailBody', sql.VarChar(8000), fit(payload.mailBody, 8000));
        manualRequest.input('EffectiveDate', sql.DateTime, payload.effectiveDate ?? payload.sendFromDate);
        manualRequest.input('IsCC', sql.Int, payload.isCC);
        manualRequest.input('IsSend', sql.Int, payload.isSend);

        const fallbackResult = await manualRequest.query(`
            DECLARE @NextMailToID decimal(18, 0);
            SELECT @NextMailToID = ISNULL(MAX(MailToID), 0) + 1
            FROM MP_MailTo WITH (UPDLOCK, HOLDLOCK);

            INSERT INTO MP_MailTo (
                MailToID, SendFromBy, SendFromDate, SendToBy, EmailTo, MailFrom, MailSubject, MailBody, EffectiveDate, IsCC, IsSend
            )
            VALUES (
                @NextMailToID, @SendFromBy, @SendFromDate, @SendToBy, @EmailTo, @MailFrom, @MailSubject, @MailBody, @EffectiveDate, @IsCC, @IsSend
            );

            SELECT @NextMailToID AS MailToID;
        `);

        const fallbackMailToId = fallbackResult.recordset?.[0]?.MailToID;
        if (fallbackMailToId === undefined || fallbackMailToId === null) {
            throw new Error('Cannot read MailToID from MP_MailTo fallback insert result');
        }
        return Number(fallbackMailToId);
    }
};

const insertMailCc = async (tx: sql.Transaction, mailToId: number, ccRecipients: MailCcRecipient[]) => {
    for (const cc of ccRecipients) {
        const ccRequest = new sql.Request(tx);
        ccRequest.input('MailToID', sql.Decimal(18, 0), mailToId);
        ccRequest.input('CCTo', sql.VarChar(8), fit(cc.employeeId, 8));
        ccRequest.input('EmailCC', sql.VarChar(100), fit(cc.email, 100));

        await ccRequest.query(`
            INSERT INTO MP_MailCC (MailToID, CCTo, EmailCC)
            VALUES (@MailToID, @CCTo, @EmailCC)
        `);
    }
};

const insertMailToList = async (
    tx: sql.Transaction,
    mailToId: number,
    refNo: string,
    createBy: string,
    createDate: Date
) => {
    const listRequest = new sql.Request(tx);
    listRequest.input('MailToID', sql.Decimal(18, 0), mailToId);
    listRequest.input('RefNo', sql.VarChar(20), fit(refNo, 20));
    listRequest.input('CreateBy', sql.VarChar(20), fit(createBy, 20));
    listRequest.input('CreateDate', sql.DateTime, createDate);

    await listRequest.query(`
        INSERT INTO MP_MailToList (MailToID, RefNo, CreateBy, CreateDate)
        VALUES (@MailToID, @RefNo, @CreateBy, @CreateDate)
    `);
};

export const createMailLog = async (payload: CreateMailLogPayload): Promise<number> => {
    const pool = await poolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const mailToId = await insertMailTo(tx, payload);

        const ccRecipients = (payload.ccRecipients || []).filter(x => fit(x.email, 100) !== '');
        if (ccRecipients.length > 0) {
            await insertMailCc(tx, mailToId, ccRecipients);
        }

        const refNo = fit(payload.refNo, 20);
        if (refNo) {
            const createBy = fit(payload.createBy || payload.sendFromBy || 'SYSTEM', 20);
            const createDate = payload.createDate || payload.sendFromDate;
            await insertMailToList(tx, mailToId, refNo, createBy, createDate);
        }

        await tx.commit();
        return mailToId;
    } catch (error) {
        try {
            await tx.rollback();
        } catch {
            // no-op
        }
        throw error;
    }
};

export default {
    createMailLog
};
