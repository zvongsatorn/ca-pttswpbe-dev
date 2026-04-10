/**
 * Mail Service for PTTSWP
 * Uses Microsoft Graph API via OAuth2 Client Credentials flow
 */
import configService from './configService.js';

let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
    const now = Date.now();
    // Use cached token if valid for at least 5 more minutes
    if (accessToken && now < tokenExpiry - 300000) {
        return accessToken;
    }

    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error('Azure AD credentials missing in environment variables');
    }

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    
    // Basic Auth header variant
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const params = new URLSearchParams();
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        const errorMsg = errorData.error_description || response.statusText;
        throw new Error(`Auth Error: ${errorMsg}`);
    }

    const data: any = await response.json();
    accessToken = data.access_token;
    // expires_in is in seconds
    tokenExpiry = now + (data.expires_in * 1000);
    
    return accessToken!;
}

export const sendMail = async (to: string, subject: string, body: string, isHtml: boolean = true) => {
    try {
        let sender = await configService.getConfig('MAIL_SENDER');
        if (!sender) {
            sender = process.env.MAIL_SENDER || '';
        }

        if (!sender) {
            throw new Error('MAIL_SENDER not configured (not in DB or .env)');
        }

        const token = await getAccessToken();
        const url = `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`;

        const mailPayload = {
            message: {
                subject: subject,
                body: {
                    contentType: isHtml ? 'HTML' : 'Text',
                    content: body
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: to
                        }
                    }
                ]
            },
            saveToSentItems: 'false'
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mailPayload)
        });

        if (!response.ok) {
            const error = await response.text();
            console.error(`Error sending email to ${to}:`, error);
            return { success: false, error };
        }

        console.log(`[MailService] Email sent successfully to ${to}`);
        return { success: true };
    } catch (error: any) {
        console.error(`[MailService] Exception sending email:`, error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Resolves the final recipient based on configuration toggles
 * @param configKey Key in MP_Config (e.g. SendMailTrans, SendMailManDriver)
 * @param originalRecipient The intended recipient
 * @returns Final email address, or null if sending is disabled
 */
export const resolveMailRecipient = async (configKey: string, originalRecipient: string): Promise<string | null> => {
    try {
        const config = await configService.getConfigDetails(configKey);
        const status = config.Value1; // '0', '1', or '2'
        const testEmail = config.Value2;

        if (status === '0') {
            console.log(`[MailService] Sending skipped for ${configKey} (Value1=0)`);
            return null;
        }

        if (status === '2') {
            console.log(`[MailService] Redirecting mail from ${originalRecipient} to test address: ${testEmail} (Value1=2)`);
            if (!testEmail || testEmail.trim() === '') {
                console.warn(`[MailService] Test email (Value2) is not configured. Returning null to avoid sending to real user ${originalRecipient}.`);
                return null;
            }
            return testEmail.trim();
        }

        return originalRecipient;
    } catch (err) {
        console.error(`Error resolving mail recipient for ${configKey}:`, err);
        return originalRecipient;
    }
};

export default {
    sendMail,
    resolveMailRecipient
};
