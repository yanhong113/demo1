CREATE TABLE platform_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
