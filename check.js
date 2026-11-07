const https = require('https');

https.get('https://pharmadash-app.onrender.com/', (res) => {
  let html = '';
  res.on('data', d => html += d);
  res.on('end', () => {
    const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!match) return console.log('No JS bundle found');
    
    https.get('https://pharmadash-app.onrender.com' + match[1], (res2) => {
      let js = '';
      res2.on('data', d => js += d);
      res2.on('end', () => {
        console.log('Includes adblocker check:', js.includes('adblocker is preventing'));
        console.log('Includes CSP fix (backend check): N/A here');
      });
    });
  });
});
