import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { getCookie } from 'hono/cookie';

export const verifyToken = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization') || '';
    const rawBearerToken = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : '';
    const bearerToken = (rawBearerToken && rawBearerToken !== 'null' && rawBearerToken !== 'undefined')
        ? rawBearerToken
        : '';
    const cookieToken = getCookie(c, 'auth_token') || '';

    if (!bearerToken && !cookieToken) {
        return c.json({ message: 'Access Denied: No Token Provided' }, 401);
    }

    try {
        const SECRET_KEY = process.env.JWT_SECRET;
        if (!SECRET_KEY) {
            console.error("CRITICAL: JWT_SECRET is not defined in environment variables.");
            return c.json({ message: 'Internal Server Error' }, 500);
        }

        const verify = (tokenValue: string) => {
            try {
                return jwt.verify(tokenValue, SECRET_KEY);
            } catch {
                return null;
            }
        };

        let decoded = bearerToken ? verify(bearerToken) : null;
        if (!decoded && cookieToken && cookieToken !== bearerToken) {
            decoded = verify(cookieToken);
        }
        if (!decoded) {
            return c.json({ message: 'Invalid Token' }, 401);
        }

        (c.req as any).user = decoded;
        await next();
    } catch (error) {
        return c.json({ message: 'Invalid Token' }, 401);
    }
};
