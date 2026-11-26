# ST0526 CI/CD Project

A Node.js + Express web application with a full CI/CD pipeline, automated testing, and report publishing to GitHub Pages.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [NPM Scripts](#npm-scripts)
- [API Endpoints](#api-endpoints)
- [Testing](#testing)
- [CI/CD Pipeline](#cicd-pipeline)
- [Reports](#reports)

---

## Project Overview

This project demonstrates a CRUD web application with a complete CI/CD workflow. It includes:

- RESTful API with error handling
- PostgreSQL database with parameterized queries
- Unit, integration, and end-to-end (E2E) tests
- ESLint + Prettier formatting
- CI pipeline with GitHub Actions (lint → test → report → deploy)
- Reports published to GitHub Pages

---

## Tech Stack

| Category       | Tools                        |
| -------------- | ---------------------------- |
| Runtime        | Node.js                      |
| Framework      | Express                      |
| Database       | PostgreSQL (via `pg` driver) |
| Unit Tests     | Jest, Supertest              |
| E2E Tests      | Playwright (Chromium)        |
| Linting        | ESLint, Prettier             |
| CI/CD          | GitHub Actions               |
| Report Hosting | GitHub Pages                 |

---

## Project Structure

```
├── .github/workflows/
│   ├── ci.yml                  # CI pipeline (lint, test, report, pages)
│   └── cd.yml                  # CD pipeline (deployment placeholder)
├── __tests__/
│   ├── unit/                   # Jest unit tests
│   ├── integration/           # Jest + Supertest integration tests
│   └── sql/                   # PostgreSQL profile-learning regressions
├── configs/
│   ├── eslint.config.mjs       # ESLint config
│   ├── jest-integration-setup.js
│   ├── playwright.config.js    # Playwright E2E config
│   └── playwright-global-setup.js
├── scripts/
│   ├── qa-report.js             # Combined QA report generator
│   ├── reset.js                # Starter table reset and seed
│   ├── starter-schema.sql      # Person and Something tables
│   ├── test-integration.js     # Disposable Luvora database and test runner
│   ├── seed.js                 # Database seeding with sample data
│   └── clean-test-results.js   # Cleanup stale test results
├── src/
│   ├── app.js                  # Express app (middleware, routes, error handling)
│   ├── server.js               # Server startup + graceful shutdown
│   ├── models/
│   │   ├── db.js               # PostgreSQL connection pool
│   │   ├── Person.model.js     # Person model
│   │   └── Something.model.js  # Something model (full CRUD)
│   ├── routers/
│   │   ├── Person.router.js    # GET /persons
│   │   └── Something.router.js # CRUD /somethings
│   └── public/
│       ├── index.html          # Frontend UI
│       └── index.js            # Frontend JavaScript
├── e2e-tests/                  # Playwright E2E test specs
├── db_Schema_Change_log/        # Luvora schema and migrations
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js** (v22 or later)
- **PostgreSQL** for development and a disposable pgvector instance for [integration tests](#integration-database)

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd web-app
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment files

Create two `.env` files in the project root:

**.env.dev** (development)

```
DATABASE_URL=postgresql://<user>:<password>@<host>/<dev-db-name>?sslmode=require
PORT=3000
```

**.env.test** (testing)

```
TEST_DATABASE_URL=postgresql://<admin>:<password>@<local-host>/<maintenance-db>
DATABASE_URL=postgresql://<user>:<password>@<host>/<playwright-test-db>
PORT=3001
```

Integration tests create their own database on the instance at `TEST_DATABASE_URL`.
Playwright resets the starter tables on the test `DATABASE_URL`.

### 4. Set up the database

```bash
npm run migration:reset
```

This resets and seeds the starter `Person` and `Something` tables. To set up
Luvora Discovery, follow the [demo setup](luvora-demo-runner.md#prepare-supabase).

### 5. Seed sample data (optional)

```bash
npm run seed
```

Inserts 20 sample persons and 2 sample somethings.

### 6. Start the server

```bash
npm run start
```

The app runs at `http://localhost:3000` by default.

---

## NPM Scripts

| Script                     | Description                              |
| -------------------------- | ---------------------------------------- |
| `npm run start`            | Start the dev server (`.env.dev`)        |
| `npm run seed`             | Seed database with sample data           |
| `npm run migration:reset`  | Reset and seed the starter tables       |
| `npm run test`             | Run all tests (unit + integration + E2E) |
| `npm run test:unit`        | Run unit tests only                      |
| `npm run test:integration` | Run migrated SQL and HTTP integration tests |
| `npm run test:sql`         | Run profile-learning SQL regressions     |
| `npm run test:e2e`         | Run Playwright E2E tests                 |
| `npm run test:trace`       | Run E2E tests with trace recording       |
| `npm run lint`             | Run ESLint                               |
| `npm run lint:fix`         | Auto-fix lint issues                     |
| `npm run lint:report`      | Generate ESLint HTML report              |
| `npm run format`           | Format code with Prettier                |
| `npm run format:check`     | Check formatting without changes         |
| `npm run report`           | Generate full QA report                  |

---

## API Endpoints

### Somethings (CRUD)

| Method   | Endpoint          | Description        | Status Codes |
| -------- | ----------------- | ------------------ | ------------ |
| `POST`   | `/somethings`     | Create a something | 201          |
| `GET`    | `/somethings`     | Get all somethings | 200          |
| `PUT`    | `/somethings/:id` | Update a something | 200, 404     |
| `DELETE` | `/somethings/:id` | Delete a something | 200, 404     |

### Persons (read-only)

| Method | Endpoint   | Description     | Status Codes |
| ------ | ---------- | --------------- | ------------ |
| `GET`  | `/persons` | Get all persons | 200          |

---

## Testing

### Test Case Design Techniques

| Technique                 | Description                                                           | Used In                |
| ------------------------- | --------------------------------------------------------------------- | ---------------------- |
| Equivalence Partitioning  | Inputs divided into valid and invalid classes, one test per partition | Unit, Integration, E2E |
| Boundary Value Analysis   | Tests at edges of input ranges (e.g. empty string, zero rows, id = 0) | Unit, Integration, E2E |
| Error Handling / Negative | Verifying correct behaviour for invalid inputs and error conditions   | Unit, Integration, E2E |

#### Unit Tests (`__tests__/unit/`)

Tests each model function in isolation with a **mocked database** (`jest.mock`).

| Technique                | Examples                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Equivalence Partitioning | Valid input (normal string), invalid input (null name, wrong type)                           |
| Boundary Value Analysis  | Empty string (shortest valid input), id = 0, negative id, empty data object (zero fields)    |
| Error Handling           | DB constraint violations, connection timeouts, connection loss — all propagate to the caller |

#### Integration Tests (`__tests__/integration/`)

Tests API endpoints using Supertest and runs PostgreSQL assertions for profile
learning. The SQL suite applies the Luvora migrations in a disposable database
and covers ranking, permissions, consent, signal decay, and cursor handling.

| Technique                | Examples                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Equivalence Partitioning | Valid creation (normal name), valid update, valid deletion, data persists after creation |
| Boundary Value Analysis  | Empty table (zero rows), non-existent id (999999)                                        |
| Error Handling           | 404 for missing resources, unknown routes return 404                                     |

#### End-to-End Tests (`e2e-tests/`)

Tests full user workflows in a **real browser** using Playwright.

| Technique                | Examples                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Equivalence Partitioning | Add single item, add multiple items, delete specific item                                       |
| Boundary Value Analysis  | Empty name (HTML5 validation blocks submit), special characters/XSS, delete all until zero rows |
| Error Handling           | Verify other rows unaffected after deletion, input clears after submit                          |

### Software Quality Tools

| Tool           | Purpose                                | How It's Used                                               |
| -------------- | -------------------------------------- | ----------------------------------------------------------- |
| ESLint         | Static code analysis (linting)         | Catches code errors and enforces coding standards           |
| Prettier       | Code formatting                        | Ensures consistent code style across the project            |
| Jest           | Unit and integration testing framework | Runs tests with mocking, assertions, and coverage reporting |
| Supertest      | HTTP integration testing               | Sends requests to Express routes and asserts responses      |
| Playwright     | End-to-end browser testing             | Automates Chromium to test full user workflows              |
| GitHub Actions | CI/CD automation                       | Runs lint, test, report, and deployment on every push/PR    |

### Test Types

| Type        | Tool             | Location                 | What It Tests                      |
| ----------- | ---------------- | ------------------------ | ---------------------------------- |
| Unit        | Jest             | `__tests__/unit/`        | Models in isolation                |
| Integration | Jest + Supertest | `__tests__/integration/` | API endpoints with a real database |
| E2E         | Playwright       | `e2e-tests/`             | Full user workflows in a browser   |

### Coverage

- Minimum **80%** threshold for branches, functions, lines, and statements
- Coverage reports generated in `coverage-report/`

### Running Tests

```bash
# All tests
npm run test

# Individual test types
npm run test:unit
npm run test:integration
npm run test:sql
npm run test:e2e
```

### Integration database

Run these commands from the folder containing `package.json`. Start a local
PostgreSQL instance with pgvector available. For example, with Docker Desktop
running in Linux-container mode:

```powershell
docker run --rm --name luvora-test-postgres -e POSTGRES_PASSWORD=luvora_test -p 127.0.0.1:55432:5432 -d pgvector/pgvector:pg17
docker exec luvora-test-postgres pg_isready -U postgres
```

When PostgreSQL accepts connections, set the following in `.env.test`:

```dotenv
TEST_DATABASE_URL=postgresql://postgres:luvora_test@127.0.0.1:55432/postgres
```

Use the administrator of a disposable local instance. The runner provisions the
minimal Auth and Storage objects needed by the migrations, including three
non-login roles if the cluster lacks them. It creates a unique test database,
applies the Luvora migrations in order, and drops the database after the run.
The SQL fixtures simulate the authenticated database role and JWT claims.

`npm run test:sql` runs the SQL suite only. `npm run test:integration` also
runs the existing HTTP route suite against the disposable database. For
`npm run test:e2e` or the full `npm test`, also set `DATABASE_URL` in `.env.test`
to a dedicated Playwright test database and set `PORT=3001`. The Playwright
setup resets and seeds the starter `Person` and `Something` tables there.

---

## CI/CD Pipeline

The CI/CD pipeline runs on every push and pull request to `main`.

### Pipeline Flow

```
Push / PR to main
       │
       ├── lint       (ESLint + Prettier)
       │
       └── test       (unit + integration + E2E)
              │
              │  ── main push only ──
              │
              ├── report   (QA report + artifacts)
              │
              └── pages    (publish reports to GitHub Pages)
```

| Job      | Triggers       | Description                         |
| -------- | -------------- | ----------------------------------- |
| `lint`   | All            | ESLint + Prettier check             |
| `test`   | All            | Unit + integration + E2E            |
| `report` | Main push only | Generate reports + upload artifacts |
| `pages`  | Main push only | Deploy reports to GitHub Pages      |

### Required GitHub Secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret         | Example Value                                                          |
| -------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL` | `postgresql://user:password@host/dbname?sslmode=require` |
| `APP_PORT`     | `3001`                                                                 |

### GitHub Pages Setup

1. Go to **Settings → Pages**
2. Set **Source** to **GitHub Actions**
3. Reports will be available at `https://<username>.github.io/<repo>/`

---

## Reports

After running `npm run report`, the following reports are generated:

| Report                         | Description                |
| ------------------------------ | -------------------------- |
| `reports/qa-report.html`       | Combined QA report         |
| `reports/eslint-report.html`   | ESLint lint analysis       |
| `coverage-report/index.html`   | HTML code coverage report  |
| `playwright-report/index.html` | Playwright E2E test report |

On push to `main`, these reports are automatically published to GitHub Pages.
