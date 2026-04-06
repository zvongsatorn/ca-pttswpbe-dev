import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';

export const verifyToken = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
        return c.json({ message: 'Access Denied: No Token Provided' }, 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return c.json({ message: 'Access Denied: Malformed Token' }, 401);
    }

    try {
        const SECRET_KEY = process.env.JWT_SECRET;
        if (!SECRET_KEY) {
            console.error("CRITICAL: JWT_SECRET is not defined in environment variables.");
            return c.json({ message: 'Internal Server Error' }, 500);
        }

        const decoded = jwt.verify(token, SECRET_KEY);

        (c.req as any).user = decoded;
        await next();
    } catch (error) {
        return c.json({ message: 'Invalid Token' }, 401);
    }
};
