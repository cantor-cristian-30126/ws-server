const express = require('express');
const fs = require('fs');

const app = express();

app.post('/upload', (req, res) => {
    let data = [];

    req.on('data', chunk => {
        data.push(chunk);
    });

    req.on('end', () => {
        const buffer = Buffer.concat(data);

        fs.writeFileSync('intruder.jpg', buffer);

        console.log("Image received!");
        res.send("OK");
    });
});

app.get('/', (req, res) => {
    res.send("Server works");
});

app.listen(10000, () => console.log("Server running"));