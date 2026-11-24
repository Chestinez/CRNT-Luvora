// Exercise Express without binding a port or touching an external network.
const { IncomingMessage, ServerResponse } = require('node:http');
const { Duplex } = require('node:stream');
module.exports = function request(app, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    const req = new IncomingMessage(socket);
    req.complete = true;
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost', ...headers };
    const text = body === undefined ? '' : JSON.stringify(body);
    if (body !== undefined)
      Object.assign(req.headers, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(text)),
      });
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    res.on('error', reject);
    res.on('finish', () => {
      const raw = Buffer.concat(chunks).toString();
      const payload = raw.slice(raw.indexOf('\r\n\r\n') + 4);
      try {
        resolve({
          status: res.statusCode,
          headers: res.getHeaders(),
          body: payload ? JSON.parse(payload) : null,
        });
      } catch (error) {
        reject(error);
      }
      socket.destroy();
    });
    app.handle(req, res);
    req.push(text || null);
    if (text) req.push(null);
  });
};
