import dotenv from 'dotenv';
import {fileURLToPath} from 'node:url';

dotenv.config({path:fileURLToPath(new URL('../../../.env',import.meta.url))});
dotenv.config({path:fileURLToPath(new URL('../../.env',import.meta.url))});

const nodeEnv=process.env.NODE_ENV||'development';
const frontendUrl=process.env.FRONTEND_URL||'http://localhost:5173';
const developmentOrigins=Array.from({length:7},(_,index)=>5173+index).flatMap(port=>[
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://[::1]:${port}`
]);
const allowedOrigins=[...new Set([frontendUrl,...(nodeEnv==='development'?developmentOrigins:[])])];

export function isAllowedOrigin(origin:string|undefined){return !origin||allowedOrigins.includes(origin);}

export const env={
  port:Number(process.env.PORT||3010),nodeEnv,frontendUrl,
  allowedOrigins,
  dbHost:process.env.DB_HOST||'127.0.0.1',dbPort:Number(process.env.DB_PORT||3306),
  dbName:process.env.DB_NAME||'del_valle_inventory',dbUser:process.env.DB_USER||'delvalle_app',
  dbPassword:process.env.DB_PASSWORD||'',sessionHours:Number(process.env.SESSION_TTL_HOURS||12),
  geminiKey:process.env.GEMINI_API_KEY||'',geminiModel:process.env.GEMINI_MODEL||'gemini-3.5-flash-lite'
};
