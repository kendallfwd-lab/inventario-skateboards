import {app} from './app.js';import {env} from './config/env.js';import {pool} from './db/connection.js';
const server=app.listen(env.port,()=>console.log(`Del Valle API listening on http://localhost:${env.port}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0)}));
