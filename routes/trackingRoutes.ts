import { Hono } from 'hono';
import { 
    getTrackingUsers, 
    getTrackingUnits 
} from '../controllers/trackingController.js';

const trackingRoutes = new Hono();

trackingRoutes.get('/users', getTrackingUsers);
trackingRoutes.get('/units', getTrackingUnits);

export default trackingRoutes;
