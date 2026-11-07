const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env');
process.env.NODE_ENV = 'production';
require('../dist/index.js').startServer();
