const express = require('express');
const createError = require('http-errors');
const path = require('path');

// Import route handlers
const somethingRouter = require('./routers/Something.router');
const personRouter = require('./routers/Person.router');
const postRouter = require('./routes/posts/posts.routes');
const discoveryRouter = require('./routes/discovery/discovery.routes');
const personalityRouter = require('./routes/personality/personality.routes');
const compatibilityRouter = require('./routes/compatibility/compatibility.routes');

const app = express();

// Parse incoming JSON request bodies (e.g. from POST/PUT requests)
app.use(express.json());

// Serve static files (HTML, CSS, JS, images) from the 'public' folder.
// e.g. src/public/index.html is accessible at http://localhost:<port>/
app.use(express.static(path.join(__dirname, 'public')));

// Browsers automatically request /favicon.ico — return 204 (no content) to avoid 404 noise.
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/somethings', somethingRouter);
app.use('/persons', personRouter);
// The team's middleware goes before these routes and sets req.user.id.
app.use(['/api/posts', '/api/discovery'], (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/posts', postRouter);
app.use('/api/discovery', discoveryRouter);
app.use('/api/personality', personalityRouter);
app.use('/api/compatibility', compatibilityRouter);

// 404 handler — if no route above matched the request,
// create a 404 error and pass it to the error handler below.
app.use((req, res, next) => {
  next(createError(404, `Unknown resource ${req.method} ${req.originalUrl}`));
});

// Global error handler — catches all errors thrown or passed via next(err).
// Sends a consistent JSON response instead of Express's default HTML error page.
// NOTE: Express requires exactly 4 parameters (error, req, res, next) to recognize
// this as an error handler. 'next' is not used here, so we disable the ESLint rule.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (/^\/api\/(posts|discovery)(\/|$)/i.test(req.path)) {
    const status = error.status || 500;
    const message = error.expose ? error.message : 'Could not complete the request.';
    if (!error.expose) console.error('Luvora API request failed', error.code || status);
    return res.set('Cache-Control', 'no-store').status(status).json({ error: message });
  }
  console.error(error);
  const status = error.status || 500;
  res.status(status).json({ error: error.message });
});

module.exports = app;
