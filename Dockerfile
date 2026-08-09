# Use official Python lightweight base image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy requirement list and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files and scripts
COPY main.py .
COPY scripts/ ./scripts/

# Expose port and run Gunicorn server
ENV PORT 8080
EXPOSE 8080

CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 main:app
