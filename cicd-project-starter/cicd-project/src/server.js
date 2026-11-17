const app = require("./app");
const http = require("node:http");
const attachChat = require("./controllers/chat/chat.socket");

const port = process.env.PORT || 3000;

const server = http.createServer(app);
attachChat(server);
server.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

// Graceful shutdown
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
