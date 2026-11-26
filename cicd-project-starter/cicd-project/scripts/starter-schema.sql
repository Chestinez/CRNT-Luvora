BEGIN;

DROP TABLE IF EXISTS public."Something";
DROP TABLE IF EXISTS public."Person";

CREATE TABLE public."Something" (
  id serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public."Person" (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  avatar text
);

COMMIT;
