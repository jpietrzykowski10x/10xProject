-- Local PostgreSQL setup for SubTracker. Run as a superuser:
--   psql -U postgres -f database/create-local-databases.sql
--
-- The role is a plain database owner (not SUPERUSER), like the user created by
-- `devil pgsql` on MyDevil, so a migration needing extra privileges fails locally first.
-- No uuid-ossp: uuid keys use the built-in gen_random_uuid() (PostgreSQL 13+).
-- The password is a local development value only.

CREATE ROLE "subtracker-adm" WITH
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    INHERIT
    NOREPLICATION
    NOBYPASSRLS
    CONNECTION LIMIT -1
    PASSWORD 'subtracker';

-- Reference database: changed only by migrations (migration:generate diffs against it).
CREATE DATABASE "subtracker-db"
    WITH
    OWNER = "subtracker-adm"
    ENCODING = 'UTF8'
    CONNECTION LIMIT = -1;

-- Working database of the app in MODE=DEV (synchronize).
CREATE DATABASE "subtracker-db-dev"
    WITH
    OWNER = "subtracker-adm"
    ENCODING = 'UTF8'
    CONNECTION LIMIT = -1;

-- PostgreSQL 15+ no longer lets every role create objects in public; make the owner
-- of each database the owner of its public schema, as on MyDevil.
\connect "subtracker-db"
ALTER SCHEMA public OWNER TO "subtracker-adm";

\connect "subtracker-db-dev"
ALTER SCHEMA public OWNER TO "subtracker-adm";
