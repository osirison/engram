-- ENGRAM Database Initialization Script
-- This script runs automatically when PostgreSQL container starts for the first time

-- Create extensions if needed in the future
-- Uncomment the following line if pgvector extension is required for vector operations
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Database is already created via POSTGRES_DB environment variable
-- Additional initialization can be added here as needed

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'ENGRAM database initialized successfully';
END $$;
