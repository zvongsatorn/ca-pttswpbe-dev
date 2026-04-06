import { Hono } from 'hono';
import { getRetirement, saveRetirement, copyRetirement } from '../controllers/retirementController.js';

const app = new Hono();

app.get('/', getRetirement);
app.post('/', saveRetirement);
app.post('/copy', copyRetirement);

export default app;
