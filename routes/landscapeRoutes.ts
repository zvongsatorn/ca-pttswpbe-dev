import { Hono } from 'hono';
import {
    createLandscapeFormula,
    deleteLandscape,
    deleteLandscapeFormula,
    getLandscape,
    getLandscapeFormulaDefault,
    getLandscapeFormulas,
    insertLandscape,
    updateLandscapeFormula,
    updateLandscape
} from '../controllers/landscapeController.js';

const app = new Hono();

app.get('/', getLandscape);
app.post('/', insertLandscape);
app.put('/', updateLandscape);
app.put('/delete', deleteLandscape);
app.get('/formula', getLandscapeFormulas);
app.get('/formula/default', getLandscapeFormulaDefault);
app.post('/formula', createLandscapeFormula);
app.put('/formula/:formulaId', updateLandscapeFormula);
app.delete('/formula/:formulaId', deleteLandscapeFormula);

export default app;
