import { listen } from '@colyseus/tools';
import server from './app.config.js';

// PORT comes from the environment (Railway sets it). Health: GET /__healthcheck
listen(server);
