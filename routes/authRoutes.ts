import { Hono } from 'hono';
import authController from '../controllers/authController.js';

const app = new Hono();
app.post('/login', authController.login);

export default app;
