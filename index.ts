import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { loadEnv } from './config/loadEnv.js';
import configService from './services/configService.js';
//Env
loadEnv();

const app = new Hono();
const port = Number(process.env.PORT || 5000);

app.use('/*', secureHeaders());
app.use('/*', cors({
    origin: (origin) => {
        if (!origin || origin.startsWith('http://localhost') || origin.endsWith('azurecontainerapps.io')) {
            return origin;
        }
        return undefined;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
app.use('/*', csrf());

// Routes
import authRoutes from './routes/authRoutes.js';
import userGroupRoutes from './routes/userGroupRoutes.js';

// Mount routes
app.route('/api/auth', authRoutes);
app.route('/api/usergroup', userGroupRoutes);

app.get('/', (c) => {
    return c.text('API requires authentication!');
});

console.log(`Server running on port ${port}`);

(async () => {
    try {
        await configService.loadConfig();
        console.log("Configuration loaded successfully.");

        serve({
            fetch: app.fetch,
            port
        });
    } catch (err) {
        console.error("Failed to load configuration or start server:", err);
        process.exit(1);
    }
})();
