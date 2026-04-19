const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let cameraClient = null;
let viewers = [];

console.log("Server pornit pe port", PORT);

wss.on("connection", (ws) => {
  console.log("Client conectat");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "camera") {
        cameraClient = ws;
        console.log("Camera conectată");
      }

      if (data.type === "viewer") {
        viewers.push(ws);
        console.log("Viewer conectat");
      }
    } catch (e) {
      // imagine binară de la ESP
      if (ws === cameraClient) {
        viewers.forEach((viewer) => {
          if (viewer.readyState === WebSocket.OPEN) {
            viewer.send(message);
          }
        });
      }
    }
  });

  ws.on("close", () => {
    console.log("Client deconectat");
    if (ws === cameraClient) cameraClient = null;
    viewers = viewers.filter(v => v !== ws);
  });
});