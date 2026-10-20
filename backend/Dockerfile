FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake libboost-all-dev swig python3 python3-dev python3-pip \
    curl ca-certificates espeak-ng libicu-dev zlib1g-dev && rm -rf /var/lib/apt/lists/*

# FreeLing 4.1 (NÃO VERIFICADO: confirma o URL e o caminho do módulo Python na primeira build).
ARG FREELING_URL=https://github.com/TALP-UPC/FreeLing/releases/download/4.1/FreeLing-4.1.tar.gz
RUN curl -fL "$FREELING_URL" -o /tmp/fl.tgz && tar xzf /tmp/fl.tgz -C /tmp && \
    mkdir /tmp/FreeLing-4.1/build && cd /tmp/FreeLing-4.1/build && \
    cmake .. -DPYTHON3_API=ON && make -j2 install && rm -rf /tmp/fl.tgz /tmp/FreeLing-4.1
ENV LD_LIBRARY_PATH=/usr/local/lib PYTHONPATH=/usr/local/share/FreeLing/APIs/python3

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt && python3 -m spacy download pt_core_news_sm
COPY pe2lgp/ ./pe2lgp/
RUN if [ -f pe2lgp/requirements.txt ]; then pip3 install --no-cache-dir -r pe2lgp/requirements.txt; fi
COPY app.py pe2lgp_adapter.py ./
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
