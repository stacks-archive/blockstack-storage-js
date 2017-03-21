const express = require('express')  
const app = express()  
const port = 5000

app.get('/', (request, response) => {
  response.send('');
})

app.get('/blockstack-bundle.js', (request, response) => {  
  response.sendFile(__dirname + '/lib/blockstack-bundle.js');
})

app.listen(port, (err) => {  
  if (err) {
    return console.log('something bad happened', err);
  }
  console.log(`server is listening on ${port}`);
})
