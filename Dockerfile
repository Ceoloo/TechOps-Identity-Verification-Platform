FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt || true
COPY src ./src
ENV PYTHONPATH=/app/src
CMD ["python", "-c", "import identity; print('identity', identity.__version__)"]
