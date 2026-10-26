# Backend Dockerfile for Google Cloud Run
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Run as non-root user for security
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Use environment variable for port (Cloud Run requirement)
ENV PORT=8080

# Run the application
# --no-server-header: hide "server: uvicorn" (main.py sets server_header=False only for `python main.py`)
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-server-header
