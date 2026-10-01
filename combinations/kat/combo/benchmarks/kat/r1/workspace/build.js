const fs = require('fs');
fs.mkdirSync('dist', {recursive: true});
fs.writeFileSync('dist/app.json', JSON.stringify({greeting: require('greetlib'), sum: 2 + 2, title: 'Kat', peer: require('needy') + '+' + require('peerlib')}));
