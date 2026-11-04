FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 KOKORO_MODEL_DIR=/models KOKORO_BIND_HOST=0.0.0.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libsndfile1 espeak-ng ca-certificates && rm -rf /var/lib/apt/lists/*
COPY server/kokoro/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY deploy/download-kokoro-models.py ./download-kokoro-models.py
RUN python download-kokoro-models.py
COPY server/kokoro/serve.py ./server/kokoro/serve.py
RUN useradd --uid 10001 --create-home kokoro
USER kokoro
EXPOSE 3003
CMD ["python", "-u", "server/kokoro/serve.py"]
