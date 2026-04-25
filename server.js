const express = require('express');
const fs = require('fs');

const app = express();

// ✅ AICI e corect pus
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

app.get('/intruder.jpg', (req, res) => {
    if (fs.existsSync('intruder.jpg')) {
        res.sendFile(__dirname + '/intruder.jpg');
    } else {
        res.send("No image");
    }
});

// alte endpoint-uri
app.get('/', (req, res) => {
    res.send("Server works");
});

// pornire server
app.listen(10000, () => console.log("Server running"));