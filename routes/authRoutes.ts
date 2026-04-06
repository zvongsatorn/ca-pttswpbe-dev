import { Hono } from 'hono';
import authController from '../controllers/authController.js';

const app = new Hono();
app.post('/login', authController.login);
app.post('/sso', authController.ssoLogin);
app.post('/register/verify', authController.registerVerifyEmail);
app.post('/register/create', authController.registerCreateAccount);
app.get('/config/:key', authController.getPublicConfig);
export default app;
