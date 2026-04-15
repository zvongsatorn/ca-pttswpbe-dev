import { Hono } from 'hono';
import {
    deleteLandscape,
    getLandscape,
    insertLandscape,
    updateLandscape
} from '../controllers/landscapeController.js';

const app = new Hono();

app.get('/', getLandscape);
app.post('/', insertLandscape);
app.put('/', updateLandscape);
app.put('/delete', deleteLandscape);

export default app;
