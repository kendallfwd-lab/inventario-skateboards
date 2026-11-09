import mysql from 'mysql2/promise'; import {env} from '../config/env.js';
export const pool=mysql.createPool({host:env.dbHost,port:env.dbPort,database:env.dbName,user:env.dbUser,password:env.dbPassword,waitForConnections:true,connectionLimit:12,queueLimit:0,timezone:'Z',decimalNumbers:true});
