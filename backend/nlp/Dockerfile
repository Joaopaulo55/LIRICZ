# Servidor NLP (spaCy 2.3 + pt_core_news_sm). Render: Root Directory = backend/nlp
FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MALLOC_ARENA_MAX=2
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt \
 && python3 -m spacy download pt_core_news_sm \
 && python3 -c "import spacy; spacy.load('pt_core_news_sm'); print('spaCy OK')"
COPY nlp_app.py .
RUN useradd -m -u 1000 app
USER app
CMD ["sh", "-c", "uvicorn nlp_app:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --no-access-log"]
