import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadEnv } from './config/loadEnv.js';
import configService from './services/configService.js';

loadEnv();

const app = new Hono();
const port = Number(process.env.PORT || 5000);

app.onError((err, c) => {
    console.error(`[Global Error Handler] ${err}`);
    return c.json({
        success: false,
        message: 'Internal Server Error',
        error: err.message,
        stack: process.env.NODE_ENV === 'local' ? err.stack : undefined
    }, 500);
});

app.use('/*', secureHeaders());
app.use('/*', cors({
    origin: (origin) => {
        if (!origin || origin.startsWith('http://localhost') || origin.includes('pttplc.com')) {
            return origin;
        }
        return undefined;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
app.use('/*', csrf({
    origin: (origin) => {
        if (!origin) return true;
        if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.includes('pttplc.com')) {
            return true;
        }
        return false;
    }
}));
// Serve uploaded files statically
app.use('/uploads/*', serveStatic({ root: './' }));

// Routes
import authRoutes from './routes/authRoutes.js';
import userGroupRoutes from './routes/userGroupRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import unitRoutes from './routes/unitRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import mkdRoutes from './routes/mkdRoutes.js';
import userRightRoutes from './routes/userRightRoutes.js';
import calendarRoutes from './routes/calendarRoutes.js';
import secondmentRoutes from './routes/secondmentRoutes.js';
import pirRoutes from './routes/pirRoutes.js';
import userRoutes from './routes/userRoutes.js';
import trackingRoutes from './routes/trackingRoutes.js';
import retirementRoutes from './routes/retirementRoutes.js';
import { filesProxy } from './controllers/mkdController.js';


// Mount routes
app.route('/api/auth', authRoutes);
app.route('/api/usergroup', userGroupRoutes);
app.route('/api/menu', menuRoutes);
app.route('/api/units', unitRoutes);
app.route('/api/transactions', transactionRoutes);
app.route('/api/documents', documentRoutes as any);
app.route('/api/mkd', mkdRoutes);
app.route('/api/user-rights', userRightRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/secondment', secondmentRoutes);
app.route('/api/pir', pirRoutes);
app.route('/api/users', userRoutes);
app.route('/api/tracking', trackingRoutes);
app.route('/api/retirement', retirementRoutes);
app.get('/api/files-proxy', filesProxy);



app.get('/', (c) => {
    return c.text('API requires authentication!');
});

console.log(`Server starting on port ${port}...`);

let server: any;

(async () => {
    try {
        await configService.loadConfig();
        console.log("Configuration loaded successfully.");

        server = serve({
            fetch: app.fetch,
            port
        });
        
        console.log(`Server is running on port ${port}`);
    } catch (err) {
        console.error("Failed to load configuration or start server:", err);
        process.exit(1);
    }
})();

// Graceful Shutdown
const shutdown = async (signal: string) => {
    console.log(`${signal} signal received. Closing server...`);
    
    if (server) {
        server.close(() => {
            console.log('HTTP server closed.');
            // Close database connections if needed
            // await db.close(); 
            process.exit(0);
        });
    } else {
        process.exit(0);
    }

    // Force close after 10s if not closed
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
