-- Walk Tracker NYC - Database Schema
-- Run this against your Neon Postgres database to initialize

CREATE EXTENSION IF NOT EXISTS postgis;

-- Raw GPS points from Overland app
CREATE TABLE IF NOT EXISTS gps_points (
  id BIGSERIAL PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  geom GEOGRAPHY(Point, 4326) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  speed REAL,
  altitude REAL,
  horizontal_accuracy REAL,
  motion TEXT[],
  is_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_points_geom ON gps_points USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_gps_points_timestamp ON gps_points(timestamp);
CREATE INDEX IF NOT EXISTS idx_gps_points_unprocessed ON gps_points(is_processed) WHERE is_processed = FALSE;

-- Street segments from OpenStreetMap (reference data)
CREATE TABLE IF NOT EXISTS street_segments (
  id BIGSERIAL PRIMARY KEY,
  osm_way_id BIGINT NOT NULL,
  geom GEOGRAPHY(LineString, 4326) NOT NULL,
  street_name VARCHAR(255),
  highway_type VARCHAR(50),
  nta_code VARCHAR(10),
  length_meters REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_street_segments_geom ON street_segments USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_street_segments_nta ON street_segments(nta_code);

-- Walked street segments (derived from GPS points snapped to streets)
CREATE TABLE IF NOT EXISTS walked_segments (
  id BIGSERIAL PRIMARY KEY,
  osm_way_id BIGINT NOT NULL UNIQUE,
  geom GEOGRAPHY(LineString, 4326) NOT NULL,
  nta_code VARCHAR(10),
  length_meters REAL NOT NULL,
  first_walked_at TIMESTAMPTZ NOT NULL,
  walk_count INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_walked_segments_geom ON walked_segments USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_walked_segments_nta ON walked_segments(nta_code);

-- Pre-computed neighborhood statistics
CREATE TABLE IF NOT EXISTS neighborhood_stats (
  nta_code VARCHAR(10) PRIMARY KEY,
  nta_name VARCHAR(255) NOT NULL,
  borough VARCHAR(50) NOT NULL,
  total_street_length_meters REAL NOT NULL DEFAULT 0,
  walked_street_length_meters REAL DEFAULT 0,
  coverage_pct REAL DEFAULT 0,
  total_segments INT NOT NULL DEFAULT 0,
  walked_segments_count INT DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);
