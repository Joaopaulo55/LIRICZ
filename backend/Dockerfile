# ---------- 1) compila o FreeLing (só português) ----------
FROM ubuntu:20.04 AS freeling
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake libboost-all-dev swig python3 python3-dev curl ca-certificates \
    libicu-dev zlib1g-dev && rm -rf /var/lib/apt/lists/*

# NÃO VERIFICADO neste ambiente (sem rede): se o URL/versão falhar, tenta --build-arg FREELING_VERSION=4.2
ARG FREELING_VERSION=4.1
RUN curl -fL "https://github.com/TALP-UPC/FreeLing/releases/download/${FREELING_VERSION}/FreeLing-${FREELING_VERSION}.tar.gz" -o /tmp/fl.tgz \
 && tar xzf /tmp/fl.tgz -C /tmp \
 && mkdir /tmp/FreeLing-${FREELING_VERSION}/build && cd /tmp/FreeLing-${FREELING_VERSION}/build \
 && cmake .. -DPYTHON3_API=ON && make -j2 install \
 && (test -f /usr/local/share/freeling/APIs/python3/pyfreeling.py \
     || { echo "pyfreeling.py não está onde o PE2LGP espera. Encontrado em:"; find /usr/local -name 'pyfreeling.py'; exit 1; }) \
 && cd /usr/local/share/freeling && for d in */; do case "$d" in pt/|common/|APIs/) ;; *) rm -rf "$d";; esac; done \
 && rm -rf /tmp/fl.tgz /tmp/FreeLing-*

# ---------- 2) imagem final ----------
# build-essential/python3-dev ficam: se alguma dependência do spaCy 2.3 não tiver wheel para Python 3.8, o pip compila-a.
FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 \
    LD_LIBRARY_PATH=/usr/local/lib \
    PYTHONPATH=/usr/local/share/freeling/APIs/python3 \
    PHONEMIZER_ESPEAK_PATH=/usr/bin/espeak-ng \
    NLTK_DATA=/usr/local/share/nltk_data \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MALLOC_ARENA_MAX=2
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev build-essential espeak-ng ca-certificates \
    libboost-system1.71.0 libboost-filesystem1.71.0 libboost-regex1.71.0 \
    libboost-program-options1.71.0 libboost-thread1.71.0 libboost-iostreams1.71.0 \
    libicu66 zlib1g libgomp1 && rm -rf /var/lib/apt/lists/*

COPY --from=freeling /usr/local/lib /usr/local/lib
COPY --from=freeling /usr/local/share/freeling /usr/local/share/freeling
RUN ldconfig \
 && for f in /usr/local/share/freeling/APIs/python3/*.so; do \
      if ldd "$f" | grep -i "not found"; then echo "Faltam as bibliotecas acima: acrescenta-as ao apt-get install."; exit 1; fi; \
    done \
 && python3 -c "import pyfreeling; print('pyfreeling OK')"

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt \
 && python3 -m spacy download pt_core_news_sm \
 && python3 -m nltk.downloader -d "$NLTK_DATA" punkt \
 && python3 -c "import spacy; spacy.load('pt_core_news_sm'); from nltk import sent_tokenize; print(sent_tokenize('Olá. Tudo bem?'))"

COPY pe2lgp/ ./pe2lgp/
RUN test -f pe2lgp/Modulo_tradutor/tradutor.py && test -f pe2lgp/Modulo_construcao_regras/freeling.py \
 || { echo "Copia Modulo_tradutor/ e Modulo_construcao_regras/ do PE2LGP para backend/pe2lgp/"; exit 1; }
COPY app.py pe2lgp_adapter.py ./

# O FreeLing exige o locale en_US.UTF-8 (sem ele aborta com "Locale name 'en_US.UTF-8' is unknown").
RUN apt-get update && apt-get install -y --no-install-recommends locales \
 && locale-gen en_US.UTF-8 && rm -rf /var/lib/apt/lists/*
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

RUN useradd -r -u 10001 app
USER app
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --no-access-log"]
