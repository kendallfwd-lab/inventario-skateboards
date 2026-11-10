import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import mysql from 'mysql2/promise';
import {env} from '../config/env.js';

const conn=await mysql.createConnection({host:env.dbHost,port:env.dbPort,database:env.dbName,user:env.dbUser,password:env.dbPassword,multipleStatements:false});
try{for(const source of ['store-seed.sql','store-demo-catalog.sql']){const file=await fs.readFile(fileURLToPath(new URL(`../../../database/${source}`,import.meta.url)),'utf8');for(const sql of file.split(';').map(x=>x.trim()).filter(Boolean))await conn.query(sql);}console.log('Datos demo de skate aplicados (repetibles).');}finally{await conn.end();}
